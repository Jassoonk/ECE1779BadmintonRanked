import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
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

app.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, display_name, rating FROM users ORDER BY rating DESC, id ASC'
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Failed to load leaderboard:', error);

    res.status(500).json({
      error: 'Failed to load leaderboard'
    });
  }
});

const derivePasswordKey = promisify(scrypt);
const scryptOptions = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const sessionDurationMs = 8 * 60 * 60 * 1000;
const startingRatings = { bronze: 200, silver: 400, gold: 600 };

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

app.post('/auth/register', async (req, res) => {
  const { email, password, invite_code, display_name, starting_rank } = req.body ?? {};

  if (invite_code !== '123456') {
    return res.status(403).json({ error: 'The invite code is incorrect.' });
  }

  const normalizedEmail = normalizeEmail(email);
  const displayName = typeof display_name === 'string' ? display_name.trim() : '';

  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@\0]+@[^\s@\0]+\.[^\s@\0]+$/.test(normalizedEmail)
  ) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  if (
    typeof password !== 'string' ||
    [...password].length < 8 ||
    Buffer.byteLength(password, 'utf8') > 1024
  ) {
    return res.status(400).json({ error: 'Use 8 or more characters and at most 1024 bytes.' });
  }

  if (!displayName || displayName.length > 100 || displayName.includes('\0')) {
    return res.status(400).json({ error: 'Enter a valid display name between 1 and 100 characters.' });
  }

  if (typeof starting_rank !== 'string' || !Object.hasOwn(startingRatings, starting_rank)) {
    return res.status(400).json({ error: 'Choose Bronze, Silver, or Gold.' });
  }

  try {
    const salt = randomBytes(16);
    const key = await derivePasswordKey(password, salt, 64, scryptOptions);
    const passwordHash = salt.toString('hex') + ':' + key.toString('hex');

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, display_name, rating)' +
        ' VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING' +
        ' RETURNING id, display_name, rating',
      [normalizedEmail, passwordHash, displayName, startingRatings[starting_rank]]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Registration failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not register. Please try again.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = normalizeEmail(email);
  res.set('Cache-Control', 'no-store');

  if (
    !normalizedEmail || normalizedEmail.length > 254 || normalizedEmail.includes('\0') ||
    typeof password !== 'string' || !password ||
    Buffer.byteLength(password, 'utf8') > 1024
  ) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, display_name, rating, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );
    const user = result.rows[0];
    const hashParts = /^([0-9a-f]{32}):([0-9a-f]{128})$/.exec(user?.password_hash ?? '');
    const salt = hashParts ? Buffer.from(hashParts[1], 'hex') : Buffer.alloc(16);
    const savedKey = hashParts ? Buffer.from(hashParts[2], 'hex') : Buffer.alloc(64);
    const enteredKey = await derivePasswordKey(password, salt, 64, scryptOptions);

    if (!timingSafeEqual(enteredKey, savedKey) || !hashParts) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionDurationMs);

    await pool.query(
      'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hashSessionToken(token), user.id, expiresAt]
    );

    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: sessionDurationMs
    });
    return res.json({ id: user.id, display_name: user.display_name, rating: user.rating });
  } catch (error) {
    console.error('Sign-in failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

app.get('/auth/session', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const cookies = req.get('cookie') ?? '';
  const sessionCookie = cookies
    .split(';')
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith('session='));
  const token = sessionCookie?.slice('session='.length) ?? '';

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }

  try {
    const result = await pool.query(
      'SELECT users.id, users.display_name, users.rating FROM user_sessions' +
        ' JOIN users ON users.id = user_sessions.user_id' +
        ' WHERE user_sessions.token_hash = $1 AND user_sessions.expires_at > NOW()',
      [hashSessionToken(token)]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Sign in to continue.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Session check failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not check your session.' });
  }
});

import { createSoloRankedRouter } from './soloRanked.js';
async function requireSession(req, res, next) {
  const cookies = req.get('cookie') ?? '';
  const sessionCookie = cookies
    .split(';')
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith('session='));

  const token = sessionCookie?.slice('session='.length) ?? '';

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }

  try {
    const result = await pool.query(
      `SELECT users.id, users.display_name, users.rating
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.token_hash = $1
         AND user_sessions.expires_at > NOW()`,
      [hashSessionToken(token)]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Sign in to continue.' });
    }

    req.soloUser = result.rows[0];
    next();
  } catch (error) {
    console.error('Session verification failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not verify session.' });
  }
}
app.use('/solo', createSoloRankedRouter(pool, requireSession));

app.listen(port, '0.0.0.0', () => {
  console.log(`Badminton Ranked is listening on port ${port}`);
});



