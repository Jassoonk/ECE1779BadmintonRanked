import { existsSync, readFileSync } from 'node:fs';
// Read the API token from a Docker secret or local environment variable.
const token = existsSync('/run/secrets/do_api_token')
    ? readFileSync('/run/secrets/do_api_token', 'utf8').trim()
    : process.env.DO_API_TOKEN;

// Fetch the last 10 minutes of monitoring data from DigitalOcean.
async function getMetric(id, metric, extra = "") {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 600;

    const url = `https://api.digitalocean.com/v2/monitoring/metrics/droplet/${metric}?host_id=${id}&start=${start}&end=${end}${extra}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Monitoring API: ${response.status}`);
    }

    const data = await response.json();
    return data.data.result;
}

// Retrieve resource metrics for a droplet.
async function getMonitoring(id) {
    const [cpu, memTotal, memAvailable, diskSize, diskFree, inbound, outbound] =
        await Promise.all([
            getMetric(id, "cpu"),
            getMetric(id, "memory_total"),
            getMetric(id, "memory_available"),
            getMetric(id, "filesystem_size"),
            getMetric(id, "filesystem_free"),
            getMetric(id, "bandwidth", "&interface=public&direction=inbound"),
            getMetric(id, "bandwidth", "&interface=public&direction=outbound")
        ]);

    // Get the latest metric value.
    const latest = series => Number(series?.values?.at(-1)?.[1] ?? NaN);

    const change = series =>
        latest(series) - Number(series.values.at(-2)?.[1] ?? NaN);

    // Calculate CPU usage from changes in cumulative CPU time.
    const totalCPU = cpu.reduce((sum, s) => sum + change(s), 0);
    const idleCPU = cpu.filter(s => s.metric.mode === "idle")
        .reduce((sum, s) => sum + change(s), 0);

    // Get disk metrics for the root filesystem.
    const rootSize = diskSize.find(s => s.metric.mountpoint === "/");
    const rootFree = diskFree.find(s => s.metric.mountpoint === "/");

    // Return resource usage metrics for the admin dashboard.
    return {
        cpu: 100 * (1 - idleCPU / totalCPU),
        memory: 100 * (1 - latest(memAvailable[0]) / latest(memTotal[0])),
        disk: 100 * (1 - latest(rootFree) / latest(rootSize)),
        inbound: latest(inbound[0]),
        outbound: latest(outbound[0])
    };
}

export { getMonitoring };