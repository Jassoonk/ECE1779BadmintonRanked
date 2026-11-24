import { readFileSync } from 'node:fs';

import pg from 'pg';

const { Pool } = pg;

// Local Compose supplies the password directly. Swarm mounts it as a file.
let dbPassword = process.env.PGPASSWORD;
if (process.env.PGPASSWORD_FILE) {
  dbPassword = readFileSync(process.env.PGPASSWORD_FILE, 'utf8').replace(/\n+$/, '');
}

// Share one connection pool across the app and doubles router, using PG environment variables for deployment.
export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'badminton',
  password: dbPassword,
  database: process.env.PGDATABASE || 'badminton_ranked',
});

// Run a minimal query to make sure PostgreSQL can accept and execute requests.
export async function checkDatabaseConnection() {
  const result = await pool.query('SELECT 1 AS connected');
  return result.rows[0].connected === 1;
}
