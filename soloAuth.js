import { createHash } from 'node:crypto';

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function getSessionToken(req) {
  const cookies = req.get('cookie') ?? '';
  const sessionCookie = cookies
    .split(';')
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith('session='));

  const token = sessionCookie?.slice('session='.length) ?? '';
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

function createSoloAuth(pool) {
  return async function requireSoloAuth(req, res, next) {
    const token = getSessionToken(req);

    if (!token) {
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
      console.error('Solo authentication failed:', error.code ?? error.name);
      return res.status(500).json({ error: 'Authentication failed.' });
    }
  };
}

export { createSoloAuth };

