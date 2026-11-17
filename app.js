import express from 'express';
import { pool, checkDatabaseConnection } from './db.js';

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.use(express.static('frontend'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/db-health', async (req, res) => {
  try {
    const connected = await checkDatabaseConnection();

    if (connected) {
      res.json({ status: 'ok', database: 'connected' });
    } else {
      res.status(503).json({
        status: 'error',
        database: 'disconnected'
      });
    }
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(503).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

app.post('/users', async (req, res) => {
  const { display_name } = req.body ?? {};

  if (
    typeof display_name !== 'string' ||
    !display_name.trim() ||
    display_name.trim().length > 100
  ) {
    return res.status(400).json({
      error: 'display_name must be between 1 and 100 characters'
    });
  }

  try {
    const result = await pool.query(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name, rating, created_at',
      [display_name.trim()]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create user:', error);

    return res.status(500).json({
      error: 'Failed to create user'
    });
  }
});

app.post('/sessions', async (req, res) => {
  const { session_date, location } = req.body ?? {};

  if (
    typeof session_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(session_date) ||
    Number.isNaN(Date.parse(`${session_date}T00:00:00Z`))
  ) {
    return res.status(400).json({
      error: 'session_date must be a valid YYYY-MM-DD date'
    });
  }

  if (
    location !== undefined &&
    location !== null &&
    (typeof location !== 'string' || location.length > 200)
  ) {
    return res.status(400).json({
      error: 'location must be a string of at most 200 characters'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sessions (session_date, location)
       VALUES ($1, $2)
       RETURNING id, session_date, location, status, created_at`,
      [session_date, location ?? null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create session:', error);

    return res.status(500).json({
      error: 'Failed to create session'
    });
  }
});


app.listen(port, '0.0.0.0', () => {
  console.log(`Badminton Ranked is listening on port ${port}`);
});
