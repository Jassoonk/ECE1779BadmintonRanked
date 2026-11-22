import express from 'express';

const MATCH_GAP = 50;  // maximum difference between the two teams' average rating
const K = 32;          // Elo update factor
const ACTIVE_WINDOW = '45 seconds';
const lockSQL = 'SELECT pg_advisory_xact_lock(1779, 2)';
const idStr = value => String(value);

function teamRating(players) {
  return players.reduce((sum, p) => sum + Number(p.rating), 0) / 2;
}
function elo(before, ownAverage, otherAverage, won) {
  const expected = 1 / (1 + 10 ** ((otherAverage - ownAverage) / 400));
  return Math.max(0, Math.round(before + K * ((won ? 1 : 0) - expected)));
}

// Look at the earliest waiting parties. A duo always stays on the same team.
function chooseTeams(parties) {
  const waiting = parties.slice(0, 12);
  let found = null;
  function pick(start, selected, size) {
    if (found) return;
    if (size === 4) {
      const duos = selected.filter(p => p.players.length === 2);
      const singles = selected.filter(p => p.players.length === 1).flatMap(p => p.players);
      let options = [];
      if (duos.length === 2) options = [[duos[0].players, duos[1].players]];
      else if (duos.length === 1 && singles.length === 2) options = [[duos[0].players, singles]];
      else if (singles.length === 4) {
        const [a,b,c,d] = singles;
        options = [[[a,b],[c,d]], [[a,c],[b,d]], [[a,d],[b,c]]];
      }
      options.sort((x,y) => Math.abs(teamRating(x[0])-teamRating(x[1])) - Math.abs(teamRating(y[0])-teamRating(y[1])));
      for (const [team1, team2] of options) {
        if (Math.abs(teamRating(team1) - teamRating(team2)) <= MATCH_GAP) {
          found = { team1, team2 };
          break;
        }
      }
      return;
    }
    for (let i = start; i < waiting.length; i++) {
      const party = waiting[i];
      if (size + party.players.length <= 4) pick(i+1, [...selected,party], size+party.players.length);
      if (found) return;
    }
  }
  pick(0, [], 0);
  return found;
}

export function createDoublesRouter(pool, requireSession) {
  const router = express.Router();
  router.use(requireSession);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(lockSQL);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  function replyError(res, error) {
    console.error('2v2 API error:', error.code ?? error.message);
    return res.status(error.httpStatus ?? 500).json({ error: error.publicMessage ?? 'Could not complete request.' });
  }
  function reject(message, httpStatus = 409) {
    throw Object.assign(new Error(message), { publicMessage: message, httpStatus });
  }
  async function assertAvailable(c, userId) {
    const existing = await c.query(
      `SELECT 1 FROM doubles_queue WHERE user_id=$1 UNION ALL
       SELECT 1 FROM doubles_match_players WHERE user_id=$1 AND active LIMIT 1`, [userId]);
    if (existing.rowCount) reject('Player is already queued or in an active match.');
  }
  async function tryMatch(c) {
    // Only freshly active users are eligible for a new match.
    const rows = (await c.query(
      `SELECT q.user_id, q.party_id, q.party_size, q.joined_at, u.rating,
              u.display_name FROM doubles_queue q
       JOIN users u ON u.id=q.user_id
       JOIN doubles_presence p ON p.user_id=q.user_id
       WHERE p.last_seen > NOW() - INTERVAL '${ACTIVE_WINDOW}'
       ORDER BY q.joined_at, q.user_id LIMIT 60`)).rows;
    const grouped = new Map();
    for (const row of rows) {
      const key = idStr(row.party_id);
      if (!grouped.has(key)) grouped.set(key, { expected: row.party_size, joined: new Date(row.joined_at).getTime(), players: [] });
      grouped.get(key).players.push({ id: idStr(row.user_id), name: row.display_name, rating: Number(row.rating) });
    }
    const parties = [...grouped.values()].filter(p => p.players.length === p.expected).sort((a,b) => a.joined-b.joined);
    const found = chooseTeams(parties);
    if (!found) return null;
    const match = (await c.query('INSERT INTO doubles_matches DEFAULT VALUES RETURNING id')).rows[0];
    for (const [teamIndex, team] of [[1, found.team1], [2, found.team2]]) {
      for (const p of team) await c.query(
        'INSERT INTO doubles_match_players (match_id,user_id,team,rating_before) VALUES ($1,$2,$3,$4)',
        [match.id, p.id, teamIndex, p.rating]);
    }
    const ids = [...found.team1, ...found.team2].map(p => p.id);
    await c.query('DELETE FROM doubles_queue WHERE user_id = ANY($1::bigint[])', [ids]);
    return match.id;
  }

  router.post('/presence', async (req, res) => {
    try {
      await pool.query(`INSERT INTO doubles_presence(user_id,last_seen) VALUES($1,NOW())
        ON CONFLICT(user_id) DO UPDATE SET last_seen=NOW()`, [req.soloUser.id]);
      res.json({ online: true });
    } catch (e) { replyError(res,e); }
  });
  router.get('/online', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT u.id, u.display_name, u.rating FROM doubles_presence p
         JOIN users u ON u.id=p.user_id
         WHERE p.last_seen > NOW() - INTERVAL '${ACTIVE_WINDOW}' AND u.id <> $1
         ORDER BY u.display_name`, [req.soloUser.id]);
      res.json(result.rows);
    } catch (e) { replyError(res,e); }
  });
  router.post('/queue/solo', async (req, res) => {
    try {
      const result = await transaction(async c => {
        const id = req.soloUser.id;
        await assertAvailable(c,id);
        const party = (await c.query("SELECT nextval('doubles_party_id_seq') AS id")).rows[0].id;
        await c.query('INSERT INTO doubles_queue(user_id,party_id,party_size) VALUES($1,$2,1)',[id,party]);
        const matchId = await tryMatch(c);
        return matchId ? { status:'matched',matchId } : { status:'waiting',mode:'solo' };
      });
      res.status(result.matchId ? 201 : 200).json(result);
    } catch(e) { replyError(res,e); }
  });
  router.post('/invites', async (req,res) => {
    const invitee = req.body?.inviteeId;
    if (!/^\d+$/.test(String(invitee ?? '')) || String(invitee) === idStr(req.soloUser.id)) return res.status(400).json({error:'Choose another player.'});
    try {
      const result = await transaction(async c => {
        await assertAvailable(c,req.soloUser.id);
        await assertAvailable(c,invitee);
        const online = await c.query(`SELECT 1 FROM doubles_presence
          WHERE user_id=$1 AND last_seen > NOW() - INTERVAL '${ACTIVE_WINDOW}'`,[invitee]);
        if (!online.rowCount) reject('Invited player is not online.');
        const exists = await c.query(`SELECT 1 FROM doubles_invites
          WHERE status='pending' AND expires_at>NOW() AND
          (inviter_id=$1 OR invitee_id=$1 OR inviter_id=$2 OR invitee_id=$2) LIMIT 1`,[req.soloUser.id,invitee]);
        if (exists.rowCount) reject('One of the players has a pending invitation.');
        return (await c.query('INSERT INTO doubles_invites(inviter_id,invitee_id) VALUES($1,$2) RETURNING id',[req.soloUser.id,invitee])).rows[0];
      });
      res.status(201).json({ status:'invited',inviteId:result.id });
    } catch(e) { replyError(res,e); }
  });
  router.post('/invites/:id/respond', async (req,res) => {
    if (!/^\d+$/.test(req.params.id) || !['accept','decline'].includes(req.body?.decision)) return res.status(400).json({error:'Invalid invitation or decision.'});
    try {
      const result = await transaction(async c => {
        const result = await c.query('SELECT * FROM doubles_invites WHERE id=$1 FOR UPDATE',[req.params.id]);
        const invite = result.rows[0];
        if (!invite) reject('Invitation not found.',404);
        if (idStr(invite.invitee_id)!==idStr(req.soloUser.id)) reject('Not your invitation.',403);
        if (invite.status !== 'pending' || new Date(invite.expires_at) <= new Date()) reject('Invitation expired or already handled.');
        if (req.body.decision === 'decline') {
          await c.query("UPDATE doubles_invites SET status='declined' WHERE id=$1",[invite.id]);
          return {status:'declined'};
        }
        await assertAvailable(c,invite.inviter_id);
        await assertAvailable(c,invite.invitee_id);
        const online = await c.query(`SELECT 1 FROM doubles_presence WHERE user_id=$1
          AND last_seen > NOW() - INTERVAL '${ACTIVE_WINDOW}'`,[invite.inviter_id]);
        if (!online.rowCount) reject('Inviter is no longer online.');
        await c.query("UPDATE doubles_invites SET status='accepted' WHERE id=$1",[invite.id]);
        const party=(await c.query("SELECT nextval('doubles_party_id_seq') AS id")).rows[0].id;
        for (const uid of [invite.inviter_id,invite.invitee_id]) await c.query(
          'INSERT INTO doubles_queue(user_id,party_id,party_size) VALUES($1,$2,2)',[uid,party]);
        const matchId=await tryMatch(c);
        return matchId ? {status:'matched', matchId} : {status:'waiting',mode:'duo'};
      });
      res.json(result);
    } catch(e) { replyError(res,e); }
  });
  router.post('/queue/cancel', async (req,res) => {
    try {
      const result=await transaction(async c => {
        const row=(await c.query('SELECT party_id FROM doubles_queue WHERE user_id=$1',[req.soloUser.id])).rows[0];
        if (!row) return {status:'idle',cancelled:false};
        await c.query('DELETE FROM doubles_queue WHERE party_id=$1',[row.party_id]);
        return {status:'idle',cancelled:true};
      });
      res.json(result);
    } catch(e) { replyError(res,e); }
  });
  router.get('/status', async (req,res) => {
    try {
      const me=req.soloUser.id;
      const match=await pool.query(`SELECT m.id, m.status, m.submitted_by, m.proposed_winning_team,
        json_agg(json_build_object('id',mp.user_id,'name',u.display_name,'team',mp.team,'rating',u.rating)
        ORDER BY mp.team,mp.user_id) AS players
        FROM doubles_matches m JOIN doubles_match_players my ON my.match_id=m.id AND my.user_id=$1
        JOIN doubles_match_players mp ON mp.match_id=m.id JOIN users u ON u.id=mp.user_id
        WHERE my.active AND m.status IN ('active','pending_confirmation')
        GROUP BY m.id ORDER BY m.created_at DESC LIMIT 1`,[me]);
      if(match.rowCount) return res.json({status:'matched',match:match.rows[0]});
      const q=await pool.query('SELECT party_size FROM doubles_queue WHERE user_id=$1',[me]);
      const pending=await pool.query(`SELECT i.id, i.inviter_id, u.display_name AS inviter_name
        FROM doubles_invites i JOIN users u ON u.id=i.inviter_id
        WHERE i.invitee_id=$1 AND i.status='pending' AND i.expires_at>NOW()
        ORDER BY i.created_at DESC`,[me]);
      const outgoing=await pool.query(`SELECT i.id, u.display_name AS invitee_name
        FROM doubles_invites i JOIN users u ON u.id=i.invitee_id
        WHERE i.inviter_id=$1 AND i.status='pending' AND i.expires_at>NOW()`,[me]);
      res.json({status:q.rowCount?'waiting':'idle', mode:q.rows[0]?.party_size===2?'duo':q.rowCount?'solo':null,
        invitations:pending.rows,outgoing:outgoing.rows});
    } catch(e) { replyError(res,e); }
  });
  router.post('/matches/:id/result', async(req,res)=>{
    if(!/^\d+$/.test(req.params.id) || !['win','loss'].includes(req.body?.result)) return res.status(400).json({error:'Invalid match or result.'});
    try {
      const result=await transaction(async c=>{
        const m=(await c.query('SELECT * FROM doubles_matches WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
        if(!m) reject('Match not found.',404);
        if(m.status!=='active') reject('Result already submitted or completed.');
        const own=(await c.query('SELECT team FROM doubles_match_players WHERE match_id=$1 AND user_id=$2',[m.id,req.soloUser.id])).rows[0];
        if(!own) reject('Not your match.',403);
        const winningTeam=req.body.result==='win'?Number(own.team):3-Number(own.team);
        await c.query(`UPDATE doubles_matches SET status='pending_confirmation', submitted_by=$2,
          proposed_winning_team=$3 WHERE id=$1`,[m.id,req.soloUser.id,winningTeam]);
        return {status:'pending_confirmation',matchId:m.id,proposedWinningTeam:winningTeam};
      });
      res.json(result);
    } catch(e) {replyError(res,e);}
  });
  router.post('/matches/:id/confirm', async(req,res)=>{
    if(!/^\d+$/.test(req.params.id) || !['confirm','dispute'].includes(req.body?.decision)) return res.status(400).json({error:'Invalid match or decision.'});
    try {
      const result=await transaction(async c=>{
        const m=(await c.query('SELECT * FROM doubles_matches WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
        if(!m) reject('Match not found.',404);
        if(m.status!=='pending_confirmation') reject('Match is not awaiting confirmation.');
        const players=(await c.query(`SELECT mp.user_id,mp.team,u.rating FROM doubles_match_players mp
          JOIN users u ON u.id=mp.user_id WHERE mp.match_id=$1 ORDER BY mp.user_id FOR UPDATE OF u`,[m.id])).rows;
        const submitter=players.find(p=>idStr(p.user_id)===idStr(m.submitted_by));
        const confirmer=players.find(p=>idStr(p.user_id)===idStr(req.soloUser.id));
        if(!confirmer) reject('Not your match.',403);
        if(submitter && confirmer.team===submitter.team) reject('Only someone on the opposing team may confirm.',403);
        if(req.body.decision==='dispute') {
          await c.query(`UPDATE doubles_matches SET status='active',submitted_by=NULL,
            proposed_winning_team=NULL WHERE id=$1`,[m.id]);
          return {status:'active',disputed:true};
        }
        const t1=players.filter(p=>p.team===1), t2=players.filter(p=>p.team===2);
        if(t1.length!==2 || t2.length!==2) throw new Error('Expected two players on each team.');
        const a=teamRating(t1),b=teamRating(t2);
        const changes=[];
        for(const p of players){
          const after=elo(p.rating,p.team===1?a:b,p.team===1?b:a,p.team===m.proposed_winning_team);
          await c.query('UPDATE users SET rating=$2 WHERE id=$1',[p.user_id,after]);
          await c.query('INSERT INTO doubles_rating_history(match_id,user_id,rating_before,rating_after) VALUES($1,$2,$3,$4)',[m.id,p.user_id,p.rating,after]);
          changes.push({id:p.user_id,before:p.rating,after,change:after-p.rating});
        }
        await c.query('UPDATE doubles_match_players SET active=FALSE WHERE match_id=$1',[m.id]);
        await c.query("UPDATE doubles_matches SET status='completed',winning_team=$2,completed_at=NOW() WHERE id=$1",[m.id,m.proposed_winning_team]);
        return {status:'completed',matchId:m.id,winningTeam:m.proposed_winning_team,ratings:changes};
      });
      res.json(result);
    } catch(e) {replyError(res,e);}
  });
  return router;
}
