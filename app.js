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

app.post('/sessions/:id/check-ins', async (req, res) => {
  const sessionId = Number(req.params.id);
  const userId = req.body?.user_id;

  if (
    !Number.isSafeInteger(sessionId) ||
    sessionId <= 0 ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    return res.status(400).json({
      error: 'Valid session_id and user_id are required'
    });
  }

  try {
    const session = await pool.query(
      'SELECT id, status FROM sessions WHERE id = $1',
      [sessionId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({
        error: 'Session not found'
      });
    }

    if (session.rows[0].status === 'completed') {
      return res.status(409).json({
        error: 'Cannot check in to a completed session'
      });
    }

    const user = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const result = await pool.query(
      `INSERT INTO check_ins (user_id, session_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, session_id) DO NOTHING
       RETURNING id, user_id, session_id, checked_in_at`,
      [userId, sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'User already checked in'
      });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to check in player:', error);

    return res.status(500).json({
      error: 'Failed to check in player'
    });
  }
});


app.get('/sessions/:id/check-ins', async (req, res) => {
  const sessionId = Number(req.params.id);

  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({
      error: 'Valid session_id is required'
    });
  }

  try {
    const session = await pool.query(
      'SELECT id FROM sessions WHERE id = $1',
      [sessionId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({
        error: 'Session not found'
      });
    }

    const result = await pool.query(
      `SELECT
         u.id AS user_id,
         u.display_name,
         u.rating,
         c.checked_in_at
       FROM check_ins c
       JOIN users u ON c.user_id = u.id
       WHERE c.session_id = $1
       ORDER BY c.checked_in_at ASC, c.id ASC`,
      [sessionId]
    );

    return res.json({
      session_id: sessionId,
      players: result.rows
    });
  } catch (error) {
    console.error('Failed to get check-ins:', error);

    return res.status(500).json({
      error: 'Failed to get check-ins'
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Badminton Ranked is listening on port ${port}`);
});
