import express from 'express';
import { pool } from './db.js';

export const doubles = express.Router();
// Determine presence and invitation expiry using the PostgreSQL clock.
const onlineSince = "NOW() - INTERVAL '45 seconds'";
const inviteSince = "NOW() - INTERVAL '3 minutes'";

// Send expected request errors to the router's JSON error handler with an HTTP status.
function reject(status, message) {
  throw Object.assign(new Error(message), { status });
}

// Keep PostgreSQL bigint IDs as strings to preserve values beyond JavaScript's safe integer range.
function checkId(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
    reject(400, 'Invalid player, invitation or match ID.');
  }
  return id;
}

// Serialize lobby and result changes across app instances. Send the reply after commit.
async function transaction(work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(1779, 2)');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

// Give each mutating route a transaction and serialize its response only after commit.
function mutation(path, work) {
  doubles.post(path, async (req, res) => {
    res.json(await transaction(db => work(db, req, res)));
  });
}

// Use the mean of both player ratings as the team's rating for matchmaking and Elo.
function average(team) {
  return (team[0].rating + team[1].rating) / 2;
}

// Try the oldest eligible parties first. A duo is always a complete team.
function chooseTeams(parties, start = 0, selected = [], count = 0) {
  if (count === 4) {
    const duo = selected.find(party => party.length === 2);
    const players = selected.flat();
    // Keep premade partners together. For four solo players, anchoring the first player avoids mirrored pairings.
    const options = duo
      ? [[duo, players.filter(player => !duo.includes(player))]]
      : players.slice(1).map(partner => {
          const team = [players[0], partner];
          return [team, players.filter(player => !team.includes(player))];
        });
    const gap = ([one, two]) => Math.abs(average(one) - average(two));
    const best = options.sort((a, b) => gap(a) - gap(b))[0];
    return gap(best) <= 50 ? best : null;
  }
  // Backtrack through whole parties in queue order until a group of four passes the rating-gap check.
  for (let i = start; i < parties.length; i++) {
    const size = count + parties[i].length;
    if (size > 4) continue;
    const teams = chooseTeams(parties, i + 1, [...selected, parties[i]], size);
    if (teams) return teams;
  }
  return null;
}

// Search a bounded window of the oldest queued parties whose members are still online.
async function tryMatch(db, playerId) {
  const { rows } = await db.query(`
    SELECT p.id, p.leader_id, a.rating, p.partner_id, b.rating AS partner_rating
    FROM doubles_parties p JOIN users a ON a.id = p.leader_id
    LEFT JOIN users b ON b.id = p.partner_id
    WHERE p.queued_at IS NOT NULL AND a.last_seen > ${onlineSince}
      AND (p.partner_id IS NULL OR b.last_seen > ${onlineSince})
    ORDER BY p.queued_at, p.id LIMIT 12`);
  const parties = rows.map(row => {
    const party = [{ id: row.leader_id, rating: row.rating, party: row.id }];
    if (row.partner_id) party.push({ id: row.partner_id, rating: row.partner_rating, party: row.id });
    return party;
  });
  const teams = chooseTeams(parties);
  if (!teams) return null;
  // Save the teams and consume their queue entries within the same transaction.
  const { rows: [match] } = await db.query('INSERT INTO doubles_matches DEFAULT VALUES RETURNING id');
  for (const [index, team] of teams.entries()) {
    for (const player of team) {
      await db.query('INSERT INTO doubles_match_players (match_id, user_id, team, rating_before) VALUES ($1,$2,$3,$4)',
        [match.id, player.id, index + 1, player.rating]);
    }
  }
  const players = teams.flat();
  await db.query('DELETE FROM doubles_parties WHERE id = ANY($1::bigint[])', [players.map(p => p.party)]);
  // Report an immediate match only if the player who triggered matchmaking is on one of its teams.
  return players.some(p => p.id === playerId) ? match.id : null;
}

// Treat current invitations, queued parties, and unfinished matches as mutually exclusive for each player.
async function assertAvailable(db, ids) {
  const { rowCount } = await db.query(`
    SELECT 1 FROM doubles_parties
    WHERE (leader_id = ANY($1) OR partner_id = ANY($1))
      AND (queued_at IS NOT NULL OR created_at > ${inviteSince})
    UNION ALL SELECT 1 FROM doubles_match_players WHERE user_id = ANY($1) AND rating_after IS NULL
    LIMIT 1`, [ids]);
  if (rowCount) reject(409, 'A player is already invited, queued or in a match.');
}

function requireInviteCode(req) {
  if (!req.inviteCodeVerified) reject(403, 'Verify the invite code before joining the queue.');
}

doubles.post('/invite-code/verify', async (req, res) => {
  const code = req.body?.invite_code;
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
    reject(400, 'Enter a six-digit invite code.');
  }

  // Save verification against the current session only when the stored code matches.
  const result = await pool.query(`
    UPDATE user_sessions
    SET invite_code_verified = TRUE
    WHERE token_hash = $1 AND expires_at > NOW()
      AND EXISTS (
        SELECT 1 FROM lobby_settings WHERE singleton AND invite_code = $2
      )
  `, [req.sessionTokenHash, code]);

  if (result.rowCount === 0) reject(403, 'The invite code is incorrect.');
  res.json({ verified: true });
});

// Refresh the heartbeat and let queued players trigger another matchmaking attempt through polling.
doubles.post('/presence', async (req, res) => {
  const id = req.player.id;
  const { rows: [presence] } = await pool.query(`UPDATE users SET last_seen = NOW() WHERE id = $1
    RETURNING EXISTS (SELECT 1 FROM doubles_parties WHERE $1 IN (leader_id, partner_id)
      AND queued_at IS NOT NULL) AS queued`, [id]);
  if (presence.queued) await transaction(db => tryMatch(db, id));
  res.json({ online: true, player: req.player, inviteCodeVerified: req.inviteCodeVerified });
});

// List other recently active players for the teammate picker.
doubles.get('/online', async (req, res) => {
  const { rows } = await pool.query(`SELECT id, display_name, rating FROM users
    WHERE last_seen > ${onlineSince} AND id <> $1 ORDER BY display_name, id`, [req.player.id]);
  res.json(rows);
});

// Queue a one-player party and check whether it can join a balanced match immediately.
mutation('/queue/solo', async (db, req, res) => {
  requireInviteCode(req);
  const id = req.player.id;
  await assertAvailable(db, [id]);
  await db.query('INSERT INTO doubles_parties (leader_id, queued_at) VALUES ($1, NOW())', [id]);
  const matchId = await tryMatch(db, id);
  if (matchId) res.status(201);
  return matchId ? { status: 'matched', matchId } : { status: 'waiting', mode: 'solo' };
});

// Clear expired invitations and reserve both players by creating a pending party.
mutation('/invites', async (db, req, res) => {
  requireInviteCode(req);
  const id = req.player.id;
  const partner = checkId(req.body?.inviteeId);
  if (partner === id) reject(400, 'Choose another player.');
  await db.query(`DELETE FROM doubles_parties WHERE queued_at IS NULL AND created_at <= ${inviteSince}`);
  await assertAvailable(db, [id, partner]);
  const online = await db.query(`SELECT 1 FROM users WHERE id = $1 AND last_seen > ${onlineSince}`, [partner]);
  if (!online.rowCount) reject(409, 'Invited player is not online.');
  const { rows: [invite] } = await db.query(
    'INSERT INTO doubles_parties (leader_id, partner_id) VALUES ($1,$2) RETURNING id', [id, partner]);
  res.status(201);
  return { status: 'invited', inviteId: invite.id };
});

// Let the invitee decline the party or queue it as a team while the inviter is still online.
mutation('/invites/:id/respond', async (db, req) => {
  const decision = req.body?.decision;
  if (!['accept', 'decline'].includes(decision)) reject(400, 'Choose accept or decline.');
  const { rows: [invite] } = await db.query(`SELECT p.*, p.created_at > ${inviteSince} AS valid,
    u.last_seen > ${onlineSince} AS online FROM doubles_parties p JOIN users u ON u.id = p.leader_id
    WHERE p.id = $1`, [checkId(req.params.id)]);
  if (!invite) reject(404, 'Invitation not found.');
  if (invite.partner_id !== req.player.id) reject(403, 'Not your invitation.');
  if (invite.queued_at || !invite.valid) reject(409, 'Invitation expired or already handled.');
  if (decision === 'decline') {
    await db.query('DELETE FROM doubles_parties WHERE id = $1', [invite.id]);
    return { status: 'declined' };
  }
  requireInviteCode(req);
  if (!invite.online) reject(409, 'Inviter is no longer online.');
  await db.query('UPDATE doubles_parties SET queued_at = NOW() WHERE id = $1', [invite.id]);
  const matchId = await tryMatch(db, req.player.id);
  return matchId ? { status: 'matched', matchId } : { status: 'waiting', mode: 'duo' };
});

// Remove the whole queued party when either member cancels.
mutation('/queue/cancel', async (db, req) => {
  const { rowCount } = await db.query(`DELETE FROM doubles_parties
    WHERE $1 IN (leader_id, partner_id) AND queued_at IS NOT NULL`, [req.player.id]);
  return { status: 'idle', cancelled: rowCount > 0 };
});

// Return the player's open match first. Otherwise report the queue or invitation state.
doubles.get('/status', async (req, res) => {
  const id = req.player.id;
  const { rows: [match] } = await pool.query(`SELECT m.id, m.status, m.submitted_by,
    m.winning_team AS proposed_winning_team,
    json_agg(json_build_object('id', p.user_id, 'name', u.display_name, 'team', p.team, 'rating', u.rating)
      ORDER BY p.team, p.user_id) AS players
    FROM doubles_match_players mine JOIN doubles_matches m ON m.id = mine.match_id
    JOIN doubles_match_players p ON p.match_id = m.id JOIN users u ON u.id = p.user_id
    WHERE mine.user_id = $1 AND mine.rating_after IS NULL GROUP BY m.id`, [id]);
  if (match) return res.json({ status: 'matched', match });
  const { rows: [party] } = await pool.query(`SELECT p.*, a.display_name AS inviter_name, b.display_name AS invitee_name
    FROM doubles_parties p JOIN users a ON a.id = p.leader_id LEFT JOIN users b ON b.id = p.partner_id
    WHERE $1 IN (p.leader_id, p.partner_id) AND (p.queued_at IS NOT NULL OR p.created_at > ${inviteSince})`, [id]);
  const waiting = Boolean(party?.queued_at);
  res.json({
    status: waiting ? 'waiting' : 'idle',
    mode: waiting ? (party.partner_id ? 'duo' : 'solo') : null,
    invitations: !waiting && party?.partner_id === id
      ? [{ id: party.id, inviter_id: party.leader_id, inviter_name: party.inviter_name }] : [],
    outgoing: !waiting && party?.leader_id === id ? [{ id: party.id, invitee_name: party.invitee_name }] : []
  });
});

// Lock the match row before reading or changing its result state.
async function getMatch(db, id) {
  const { rows: [match] } = await db.query('SELECT * FROM doubles_matches WHERE id = $1 FOR UPDATE', [checkId(id)]);
  if (!match) reject(404, 'Match not found.');
  return match;
}

// Translate a player's win or loss report into a proposed winning team for the opponent to review.
mutation('/matches/:id/result', async (db, req) => {
  const result = req.body?.result;
  if (!['win', 'loss'].includes(result)) reject(400, 'Choose win or loss.');
  const match = await getMatch(db, req.params.id);
  const { rows: [player] } = await db.query('SELECT team FROM doubles_match_players WHERE match_id = $1 AND user_id = $2',
    [match.id, req.player.id]);
  if (!player) reject(403, 'Not your match.');
  if (match.status !== 'active') reject(409, 'Result already submitted or completed.');
  const winningTeam = result === 'win' ? player.team : 3 - player.team;
  await db.query(`UPDATE doubles_matches SET status = 'pending_confirmation', submitted_by = $2, winning_team = $3
    WHERE id = $1`, [match.id, req.player.id, winningTeam]);
  return { status: 'pending_confirmation', matchId: match.id, proposedWinningTeam: winningTeam };
});

// Let an opposing player finalize the proposed result or reopen the match for a new report.
mutation('/matches/:id/confirm', async (db, req) => {
  const decision = req.body?.decision;
  if (!['confirm', 'dispute'].includes(decision)) reject(400, 'Choose confirm or dispute.');
  const match = await getMatch(db, req.params.id);
  if (match.status !== 'pending_confirmation') reject(409, 'Match is not awaiting confirmation.');
  const { rows: players } = await db.query(`SELECT u.id, p.team, u.rating FROM doubles_match_players p
    JOIN users u ON u.id = p.user_id WHERE p.match_id = $1 ORDER BY u.id FOR UPDATE OF u`, [match.id]);
  const confirmer = players.find(p => p.id === req.player.id);
  const submitter = players.find(p => p.id === match.submitted_by);
  if (!confirmer || confirmer.team === submitter.team) reject(403, 'Only an opposing player can review this result.');
  if (decision === 'dispute') {
    await db.query("UPDATE doubles_matches SET status = 'active', submitted_by = NULL, winning_team = NULL WHERE id = $1", [match.id]);
    return { status: 'active', disputed: true };
  }
  const teamOne = players.filter(p => p.team === 1);
  const teamTwo = players.filter(p => p.team === 2);
  if (teamOne.length !== 2 || teamTwo.length !== 2) throw new Error('Incomplete doubles match.');
  const one = average(teamOne);
  const two = average(teamTwo);
  // Apply Elo with team averages for expected scores and a K-factor of 32, then record each player's change.
  const ratings = [];
  for (const { id, team, rating } of players) {
    const expected = 1 / (1 + 10 ** ((team === 1 ? two - one : one - two) / 400));
    const score = team === match.winning_team ? 1 : 0;
    const after = Math.max(0, Math.round(rating + 32 * (score - expected)));
    await db.query('UPDATE users SET rating = $2 WHERE id = $1', [id, after]);
    await db.query('UPDATE doubles_match_players SET rating_before = $3, rating_after = $4 WHERE match_id = $1 AND user_id = $2',
      [match.id, id, rating, after]);
    ratings.push({ id, before: rating, after, change: after - rating });
  }
  await db.query("UPDATE doubles_matches SET status = 'completed', completed_at = NOW() WHERE id = $1", [match.id]);
  return { status: 'completed', matchId: match.id, winningTeam: match.winning_team, ratings };
});

// Return a consistent JSON error shape and log unexpected failures on the server.
doubles.use((error, req, res, next) => {
  if (!error.status) console.error('Doubles request failed:', error);
  res.status(error.status ?? 500).json({ error: error.status ? error.message : 'Could not complete request.' });
});
