import { calculateElo } from './soloElo.js';
import express from 'express';
import { createSoloAuth } from './soloAuth.js';

function createSoloRankedRouter(pool) {
  const router = express.Router();
  const requireAuth = createSoloAuth(pool);

  router.post('/queue/join', requireAuth, async (req, res) => {
    const userId = req.soloUser.id;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Serialize matchmaking operations across requests.
      await client.query('SELECT pg_advisory_xact_lock(1779, 1)');

      const existingMatch = await client.query(
        `SELECT id FROM solo_matches
         WHERE status IN ('active', 'pending_confirmation')
           AND (player1_id = $1 OR player2_id = $1)
         LIMIT 1`,
        [userId]
      );

      if (existingMatch.rowCount > 0) {
        await client.query('COMMIT');
        return res.status(409).json({
          error: 'You already have an active match.',
          matchId: existingMatch.rows[0].id
        });
      }

      await client.query(
        `INSERT INTO solo_queue (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      const opponent = await client.query(
        `SELECT q.user_id, u.rating
         FROM solo_queue q
         JOIN users u ON u.id = q.user_id
         WHERE q.user_id <> $1
           AND ABS(u.rating - $2) <= 50
           AND NOT EXISTS (
             SELECT 1 FROM solo_matches m
             WHERE m.status IN ('active', 'pending_confirmation')
               AND (m.player1_id = q.user_id OR m.player2_id = q.user_id)
           )
         ORDER BY ABS(u.rating - $2), q.joined_at
         LIMIT 1`,
        [userId, req.soloUser.rating]
      );

      if (opponent.rowCount === 0) {
        await client.query('COMMIT');
        return res.json({ status: 'waiting' });
      }

      const other = opponent.rows[0];

      const match = await client.query(
        `INSERT INTO solo_matches
         (player1_id, player2_id, player1_rating_before, player2_rating_before)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [userId, other.user_id, req.soloUser.rating, other.rating]
      );

      await client.query(
        `DELETE FROM solo_queue WHERE user_id IN ($1, $2)`,
        [userId, other.user_id]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        status: 'matched',
        matchId: match.rows[0].id,
        opponentId: other.user_id,
        opponentRating: other.rating
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Solo matchmaking failed:', error.code ?? error.message);
      return res.status(500).json({ error: 'Matchmaking failed.' });
    } finally {
      client.release();
    }
  });

  router.get('/queue/status', requireAuth, async (req, res) => {
    const userId = req.soloUser.id;

    try {
      const match = await pool.query(
        `SELECT m.id, m.status,
                u.id AS opponent_id,
                u.display_name AS opponent_name,
                u.rating AS opponent_rating
         FROM solo_matches m
         JOIN users u ON u.id =
           CASE WHEN m.player1_id = $1
                THEN m.player2_id ELSE m.player1_id END
         WHERE (m.player1_id = $1 OR m.player2_id = $1)
           AND m.status IN ('active', 'pending_confirmation')
         ORDER BY m.created_at DESC
         LIMIT 1`,
        [userId]
      );

      if (match.rowCount > 0) {
        return res.json({
          status: 'matched',
          match: match.rows[0]
        });
      }

      const queue = await pool.query(
        'SELECT joined_at FROM solo_queue WHERE user_id = $1',
        [userId]
      );

      return res.json({
        status: queue.rowCount > 0 ? 'waiting' : 'idle'
      });
    } catch (error) {
      console.error('Queue status failed:', error.code ?? error.message);
      return res.status(500).json({ error: 'Could not load queue status.' });
    }
  });
  router.post('/queue/cancel', requireAuth, async (req, res) => {
    const userId = req.soloUser.id;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(1779, 1)');

      const activeMatch = await client.query(
        `SELECT id FROM solo_matches
         WHERE status IN ('active', 'pending_confirmation')
           AND (player1_id = $1 OR player2_id = $1)
         LIMIT 1`,
        [userId]
      );

      if (activeMatch.rowCount > 0) {
        await client.query('COMMIT');
        return res.status(409).json({
          error: 'Already matched. Cannot cancel queue.',
          matchId: activeMatch.rows[0].id
        });
      }

      const result = await client.query(
        'DELETE FROM solo_queue WHERE user_id = $1',
        [userId]
      );

      await client.query('COMMIT');

      return res.json({
        status: 'idle',
        cancelled: result.rowCount > 0
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Queue cancellation failed:', error.code ?? error.message);
      return res.status(500).json({ error: 'Could not cancel matchmaking.' });
    } finally {
      client.release();
    }
  });
  router.post('/matches/:id/result', requireAuth, async (req, res) => {
    const matchId = req.params.id;
    const userId = req.soloUser.id;
    const { result } = req.body ?? {};

    if (!/^[1-9]\d*$/.test(matchId)) {
      return res.status(400).json({ error: 'Invalid match ID.' });
    }

    if (!['win', 'loss'].includes(result)) {
      return res.status(400).json({
        error: 'Result must be win or loss.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const matchResult = await client.query(
        `SELECT * FROM solo_matches
         WHERE id = $1
         FOR UPDATE`,
        [matchId]
      );

      if (matchResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Match not found.' });
      }

      const match = matchResult.rows[0];

      if (match.player1_id != userId && match.player2_id != userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your match.' });
      }

      if (match.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Match result already submitted or completed.'
        });
      }

      const opponentId =
        match.player1_id == userId ? match.player2_id : match.player1_id;

      const winnerId = result === 'win' ? userId : opponentId;

      await client.query(
        `UPDATE solo_matches
         SET status = 'pending_confirmation',
             submitted_by = $1,
             proposed_winner_id = $2
         WHERE id = $3`,
        [userId, winnerId, matchId]
      );

      await client.query('COMMIT');

      return res.json({
        status: 'pending_confirmation',
        matchId,
        submittedResult: result,
        awaitingConfirmationFrom: opponentId
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Submit result failed:', error.code ?? error.message);
      return res.status(500).json({ error: 'Could not submit result.' });
    } finally {
      client.release();
    }
  });
  router.post('/matches/:id/confirm', requireAuth, async (req, res) => {
    const matchId = req.params.id;
    const userId = String(req.soloUser.id);
    const { decision } = req.body ?? {};

    if (!/^[1-9]\d*$/.test(matchId)) {
      return res.status(400).json({ error: 'Invalid match ID.' });
    }

    if (!['confirm', 'dispute'].includes(decision)) {
      return res.status(400).json({
        error: 'Decision must be confirm or dispute.'
      });
    }

    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT * FROM solo_matches
         WHERE id = $1 FOR UPDATE`,
        [matchId]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Match not found.' });
      }

      const match = result.rows[0];
      const player1 = String(match.player1_id);
      const player2 = String(match.player2_id);

      if (userId !== player1 && userId !== player2) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your match.' });
      }

      if (match.status !== 'pending_confirmation') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Match is not awaiting confirmation.'
        });
      }

      if (String(match.submitted_by) === userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'You cannot confirm your own result.'
        });
      }

      if (decision === 'dispute') {
        await client.query(
          `UPDATE solo_matches
           SET status = 'active',
               submitted_by = NULL,
               proposed_winner_id = NULL
           WHERE id = $1`,
          [matchId]
        );

        await client.query('COMMIT');

        return res.json({
          status: 'active',
          disputed: true,
          message: 'Result disputed. Submit a corrected result.'
        });
      }

      const users = await client.query(
        `SELECT id, rating FROM users
         WHERE id IN ($1, $2)
         ORDER BY id FOR UPDATE`,
        [player1, player2]
      );

      if (users.rowCount !== 2) {
        throw new Error('Match players not found');
      }

      const ratings = new Map(
        users.rows.map(row => [String(row.id), row.rating])
      );

      const rating1 = ratings.get(player1);
      const rating2 = ratings.get(player2);

      const winnerId = String(match.proposed_winner_id);

      if (winnerId !== player1 && winnerId !== player2) {
        throw new Error('Invalid proposed winner');
      }

      const winner = winnerId === player1 ? 'A' : 'B';
      const elo = calculateElo(rating1, rating2, winner);

      await client.query(
        `UPDATE users
         SET rating = CASE
           WHEN id = $1 THEN $3::integer
           WHEN id = $2 THEN $4::integer
           ELSE rating
         END
         WHERE id IN ($1, $2)`,
        [player1, player2, elo.player1.after, elo.player2.after]
      );

      await client.query(
        `INSERT INTO solo_rating_history
         (match_id, user_id, rating_before, rating_after)
         VALUES
         ($1, $2, $3, $4),
         ($1, $5, $6, $7)`,
        [
          matchId,
          player1, elo.player1.before, elo.player1.after,
          player2, elo.player2.before, elo.player2.after
        ]
      );

      await client.query(
        `UPDATE solo_matches
         SET status = 'completed',
             winner_id = $2,
             completed_at = NOW()
         WHERE id = $1`,
        [matchId, winnerId]
      );

      await client.query('COMMIT');

      return res.json({
        status: 'completed',
        matchId,
        winnerId,
        ratings: {
          player1: elo.player1,
          player2: elo.player2
        }
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      console.error('Match confirmation failed:', error.code ?? error.message);
      return res.status(500).json({
        error: 'Could not confirm match result.'
      });
    } finally {
      if (client) client.release();
    }
  });
  return router;
}

export { createSoloRankedRouter };






