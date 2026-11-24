async function getMetric(id, metric, extra = "") {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 600;

    const url = `https://api.digitalocean.com/v2/monitoring/metrics/droplet/${metric}?host_id=${id}&start=${start}&end=${end}${extra}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${process.env.DO_API_TOKEN}`
        }
    });

    if (!response.ok) {
        throw new Error(`Monitoring API: ${response.status}`);
    }

    const data = await response.json();
    return data.data.result;
}

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

    const latest = series => Number(series?.values?.at(-1)?.[1] ?? NaN);

    const change = series =>
        latest(series) - Number(series.values.at(-2)?.[1] ?? NaN);

    const totalCPU = cpu.reduce((sum, s) => sum + change(s), 0);
    const idleCPU = cpu.filter(s => s.metric.mode === "idle")
        .reduce((sum, s) => sum + change(s), 0);

    const rootSize = diskSize.find(s => s.metric.mountpoint === "/");
    const rootFree = diskFree.find(s => s.metric.mountpoint === "/");

    return {
        cpu: 100 * (1 - idleCPU / totalCPU),
        memory: 100 * (1 - latest(memAvailable[0]) / latest(memTotal[0])),
        disk: 100 * (1 - latest(rootFree) / latest(rootSize)),
        inbound: latest(inbound[0]),
        outbound: latest(outbound[0])
    };
}

export { getMonitoring };