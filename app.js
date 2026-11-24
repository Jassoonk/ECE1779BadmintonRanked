import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { doubles } from './doubles.js';
import { pool, checkDatabaseConnection } from './db.js';
import { getMonitoring } from "./monitoring.js";

// Configure the Express server for JSON API requests and static browser assets.
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.use(express.static('frontend'));

app.get('/admin', (_req, res) => {
  res.sendFile('admin.html', { root: 'frontend' });
});

// Configure the admin password through the environment on each replica.
const adminPassword = process.env.ADMIN_PASSWORD;

app.post('/admin/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!adminPassword) {
    return res.status(503).json({ error: 'Admin sign-in is unavailable.' });
  }

  if (req.body?.password !== adminPassword) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }

  try {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()');
    await pool.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [hashSessionToken(token), expiresAt]
    );
    return res.json({ message: 'Admin password accepted.', token });
  } catch (error) {
    console.error('Admin sign-in failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not sign in as admin.' });
  }
});

// A token issued by one replica can be verified by any replica using the same database.
async function requireAdmin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const token = req.get('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!adminPassword || !token) {
    return res.status(401).json({ error: 'Sign in as admin to continue.' });
  }

  try {
    const result = await pool.query(
      'SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [hashSessionToken(token)]
    );
    if (!result.rowCount) {
      return res.status(401).json({ error: 'Sign in as admin to continue.' });
    }
  } catch (error) {
    console.error('Admin session check failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not check the admin session.' });
  }
  next();
}

app.get('/admin/queue-length', requireAdmin, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT COUNT(*) + COUNT(partner_id) AS queue_length
        FROM doubles_parties
        WHERE queued_at IS NOT NULL
    `);

    res.json({ queueLength: Number(rows[0].queue_length) });
});

app.get('/admin/monitoring', requireAdmin, async (req, res) => {
    try {
        const [manager, worker] = await Promise.all([
            getMonitoring(622789369),
            getMonitoring(622850943)
        ]);

        res.json({ manager, worker });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Monitoring unavailable" });
    }
});

app.get('/admin/matches', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.status, m.team1_score, m.team2_score,
             m.corrected_team1_score, m.corrected_team2_score,
             array_agg(u.display_name ORDER BY p.user_id) FILTER (WHERE p.team = 1) AS team1,
             array_agg(u.display_name ORDER BY p.user_id) FILTER (WHERE p.team = 2) AS team2
      FROM doubles_matches m
      JOIN doubles_match_players p ON p.match_id = m.id
      JOIN users u ON u.id = p.user_id
      WHERE m.status <> 'completed'
      GROUP BY m.id
      ORDER BY m.created_at, m.id
    `);
    res.json(rows);
  } catch (error) {
    console.error('Current match lookup failed:', error.code ?? error.name);
    res.status(500).json({ error: 'Could not load current matches.' });
  }
});

app.post('/admin/invite-code', requireAdmin, async (req, res) => {
  const code = req.body?.invite_code;
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter a six-digit invite code.' });
  }

  try {
    // Only save the code when there are no player accounts.
    const result = await pool.query(`
      INSERT INTO lobby_settings (invite_code)
      SELECT $1
      WHERE NOT EXISTS (SELECT 1 FROM users)
      ON CONFLICT (singleton)
      DO UPDATE SET invite_code = EXCLUDED.invite_code
    `, [code]);

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: 'You can change the invite code only before any players have registered.'
      });
    }
    return res.json({ message: 'Invite code saved.' });
  } catch (error) {
    console.error('Invite code save failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not save the invite code.' });
  }
});

app.patch('/admin/players/:id/rating', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const rating = req.body?.rating;
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
    return res.status(400).json({ error: 'Invalid player ID.' });
  }
  // Validate the rating here as well as in the admin form.
  if (!Number.isInteger(rating) || rating < 0 || rating > 1000) {
    return res.status(400).json({ error: 'Enter a whole-number rating between 0 and 1000.' });
  }

  try {
    const result = await pool.query('UPDATE users SET rating = $1 WHERE id = $2', [rating, id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Player not found.' });
    }
    return res.json({ message: 'Rating saved.' });
  } catch (error) {
    console.error('Rating save failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not save the rating.' });
  }
});

app.delete('/admin/players', requireAdmin, async (_req, res) => {
  try {
    // Clear player records and their dependent lobby and match data together.
    await pool.query(`
      TRUNCATE TABLE users, user_sessions, doubles_parties, doubles_matches, doubles_match_players
    `);
    return res.json({ message: 'All players and their match history were deleted.' });
  } catch (error) {
    console.error('Player deletion failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not delete the players.' });
  }
});

// Keep the app liveness check independent of PostgreSQL.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Report database readiness separately so monitoring can distinguish app and database failures.
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

// Return public player details, using the player ID to break rating ties consistently.
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

// Use the same scrypt parameters when creating and verifying stored password hashes.
const derivePasswordKey = promisify(scrypt);
const scryptOptions = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const sessionDurationMs = 8 * 60 * 60 * 1000;
const startingRatings = { bronze: 200, silver: 400, gold: 600 };

// Canonicalize email addresses so registration and sign-in use the same database key.
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// Store and look up only a digest of each session token in PostgreSQL.
function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Validate account fields before running scrypt or writing to the database.
app.post('/auth/register', async (req, res) => {
  const { email, password, display_name, starting_rank } = req.body ?? {};
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
    // Generate a fresh salt and save it alongside the derived key for sign-in.
    const salt = randomBytes(16);
    const key = await derivePasswordKey(password, salt, 64, scryptOptions);
    const passwordHash = salt.toString('hex') + ':' + key.toString('hex');

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, display_name, rating)' +
        ' VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING' +
        ' RETURNING id, display_name, rating',
      [normalizedEmail, passwordHash, displayName, startingRatings[starting_rank]]
    );

    // The unique email constraint settles duplicate registrations, including concurrent attempts.
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Registration failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not register. Please try again.' });
  }
});

// Verify the submitted credentials, then create a browser session.
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
    // Use fixed-size fallback buffers so missing or malformed hashes still go through scrypt and comparison.
    const salt = hashParts ? Buffer.from(hashParts[1], 'hex') : Buffer.alloc(16);
    const savedKey = hashParts ? Buffer.from(hashParts[2], 'hex') : Buffer.alloc(64);
    const enteredKey = await derivePasswordKey(password, salt, 64, scryptOptions);

    if (!timingSafeEqual(enteredKey, savedKey) || !hashParts) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    // Give the cookie and the stored session the same configured lifetime.
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

// Resolve a session cookie to a current player record before entering protected routes.
async function requireSession(req, res, next) {
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
    const tokenHash = hashSessionToken(token);
    const result = await pool.query(`
      SELECT u.id, u.display_name, u.rating,
             s.invite_code_verified AS "inviteCodeVerified"
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
    `, [tokenHash]);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Sign in to continue.' });
    }

    // Pass the database-backed player to the session endpoint and the doubles router.
    const { inviteCodeVerified, ...player } = result.rows[0];
    req.player = player;
    req.inviteCodeVerified = inviteCodeVerified;
    req.sessionTokenHash = tokenHash;
    return next();
  } catch (error) {
    console.error('Session check failed:', error.code ?? error.name);
    return res.status(500).json({ error: 'Could not check your session.' });
  }
}

app.get('/auth/session', requireSession, (req, res) => res.json(req.player));
app.use('/doubles', requireSession, doubles);

// Bind to all interfaces so the server can receive traffic through the container port mapping.
app.listen(port, '0.0.0.0', () => {
  console.log(`Badminton Ranked is listening on port ${port}`);
});
