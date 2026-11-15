
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'badminton',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'badminton_ranked',
});

export async function checkDatabaseConnection() {
  const result = await pool.query('SELECT 1 AS connected');
  return result.rows[0].connected === 1;
}
