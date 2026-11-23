// Keep the doubles lobby's polling and DOM helpers private to this script.
(() => {
  const byId = id => document.getElementById(id);
  const status = byId('doubles-status');
  const message = byId('doubles-message');
  const inviteCodeForm = byId('doubles-invite-code-form');
  const actions = byId('doubles-actions');
  const cancel = byId('doubles-cancel');
  const invites = byId('doubles-invites');
  const details = byId('doubles-details');
  const scoreForm = byId('doubles-score-form');
  const duo = byId('duo-queue');
  const picker = byId('doubles-person');
  let lastStatus;
  let scoreContext;
  let polling;
  let acting = false;

  // Use the session cookie on same-origin lobby requests and preserve HTTP status for UI error handling.
  async function request(path, method = 'GET', body) {
    const response = await fetch(`/doubles${path}`, {
      method, cache: 'no-store',
      headers: body && { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  }

  // Serialize user actions with polling, then refresh from the server after every attempt.
  async function act(path, body) {
    if (acting) return;
    acting = true;
    try {
      await polling;
      await request(path, 'POST', body);
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      await refresh();
      acting = false;
    }
  }

  // Create action buttons that submit through the same request and refresh flow.
  function button(label, style, path, body) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `btn btn-sm me-2 mb-2 btn-${style}`;
    element.textContent = label;
    element.addEventListener('click', () => act(path, body));
    return element;
  }

  // Collect the player's score first for a new result. Corrections use team order.
  function scoreInput(path, playerTeam) {
    const first = scoreForm.elements.team1_score;
    const second = scoreForm.elements.team2_score;
    const submit = scoreForm.querySelector('button');
    const outcome = byId('doubles-score-outcome');
    const reporting = playerTeam !== undefined;

    scoreForm.reset();
    byId('doubles-score-first-label').textContent = reporting ? 'Enter your score' : 'Team 1 score';
    byId('doubles-score-second-label').textContent = reporting ? "Enter your opponents' score" : 'Team 2 score';
    scoreForm.hidden = false;

    scoreForm.oninput = () => {
      second.disabled = second.parentElement.hidden = reporting && !first.validity.valid;
      const complete = first.validity.valid && !second.disabled && second.validity.valid;
      const tied = complete && first.valueAsNumber === second.valueAsNumber;
      submit.hidden = reporting && !complete;
      submit.disabled = !complete || tied;
      outcome.textContent = '';
      if (tied) {
        outcome.textContent = 'Enter two different scores.';
      } else if (reporting && complete) {
        outcome.textContent = first.valueAsNumber > second.valueAsNumber
          ? "Congratulations, you've won!"
          : "You've lost.";
      }
    };
    scoreForm.oninput();

    scoreForm.onsubmit = event => {
      event.preventDefault();
      if (submit.disabled) return;
      const [team1_score, team2_score] = playerTeam === 2
        ? [second.valueAsNumber, first.valueAsNumber]
        : [first.valueAsNumber, second.valueAsNumber];
      act(path, { team1_score, team2_score });
    };
    if (!reporting) first.focus();
  }

  function showScore(label, first, second) {
    const line = document.createElement('p');
    const team1 = document.createElement('strong');
    const team2 = document.createElement('strong');
    team1.className = team2.className = 'fs-4';
    team1.textContent = first;
    team2.textContent = second;
    line.append(label + ': Team 1: ', team1, ' - Team 2: ', team2);
    details.append(line);
  }

  // Render team rosters, then show result controls for the current match state.
  function renderMatch(match, player) {
    const heading = document.createElement('h3');
    heading.className = 'h6';
    heading.textContent = `Match #${match.id}`;
    details.append(heading);
    for (const team of [1, 2]) {
      const line = document.createElement('p');
      line.append(`Team ${team}: `);
      for (const [index, member] of match.players.filter(p => p.team === team).entries()) {
        if (index > 0) line.append(' + ');
        const name = document.createElement(String(member.id) === String(player.id) ? 'strong' : 'span');
        name.textContent = member.name;
        line.append(name, ` (${member.rating})`);
      }
      details.append(line);
    }
    if (match.status === 'active') return;

    if (Number.isInteger(match.team1_score) && Number.isInteger(match.team2_score)) {
      showScore('Reported score', match.team1_score, match.team2_score);
    } else {
      const text = document.createElement('p');
      text.textContent = `Reported winner: Team ${match.proposed_winning_team}. Waiting for the opposing team.`;
      details.append(text);
    }
    if (match.status === 'pending_correction') {
      showScore('Corrected score', match.corrected_team1_score, match.corrected_team2_score);
    }

    const path = `/matches/${match.id}`;

    if (match.can_review_score) {
      const dispute = document.createElement('button');
      dispute.type = 'button';
      dispute.className = 'btn btn-sm me-2 mb-2 btn-outline-primary';
      dispute.textContent = 'Dispute';
      dispute.onclick = () => scoreInput(path + '/correct');
      details.append(button('Agree', 'success', path + '/confirm', { decision: 'confirm' }), dispute);
    }
  }

  // Send a presence heartbeat before reading the latest invitation, queue, or match state.
  async function update() {
    try {
      const { player, inviteCodeVerified } = await request('/presence', 'POST');
      const data = await request('/status');
      const incoming = data.invitations?.[0];
      const outgoing = data.outgoing?.[0];
      // Use the server's session state so verification survives a refresh.
      inviteCodeForm.hidden = data.status !== 'idle' || inviteCodeVerified;
      actions.hidden = data.status !== 'idle' || !inviteCodeVerified || Boolean(incoming || outgoing);
      cancel.hidden = data.status !== 'waiting';
      if (actions.hidden) duo.open = false;
      invites.replaceChildren();
      details.replaceChildren();

      // Keep the form open during polling unless the player or match state changes.
      const currentScoreContext = data.match
        ? `${player.id}/${data.match.id}/${data.match.status}/${data.match.can_review_score}`
        : null;
      if (currentScoreContext !== scoreContext) {
        scoreForm.hidden = true;
        scoreContext = currentScoreContext;
        if (data.match?.status === 'active') {
          const member = data.match.players.find(p => String(p.id) === String(player.id));
          scoreInput(`/matches/${data.match.id}/result`, member.team);
        }
      }

      if (data.match) {
        status.textContent = 'Match found!';
        renderMatch(data.match, player);
      } else if (data.status === 'waiting') {
        status.textContent = `Searching for opponents (${data.mode})...`;
      } else if (incoming) {
        status.textContent = `${incoming.inviter_name} invited you to play doubles.`;
        const path = `/invites/${incoming.id}/respond`;
        if (inviteCodeVerified) {
          invites.append(button('Accept', 'success', path, { decision: 'accept' }));
        }
        invites.append(button('Decline', 'outline-danger', path, { decision: 'decline' }));
      } else if (outgoing) {
        status.textContent = `Invitation sent to ${outgoing.invitee_name}. Waiting for acceptance.`;
      } else {
        status.textContent = inviteCodeVerified
          ? 'Ready to play doubles.'
          : 'Enter the invite code to join a queue.';
      }
      // After a match completes, reload both the leaderboard and the signed-in player's displayed rating.
      if (lastStatus === 'matched' && data.status === 'idle') {
        message.textContent = 'Match complete. Rankings refreshed.';
        loadLeaderboard();
        const session = await fetch('/auth/session', { cache: 'no-store' });
        if (session.ok) showSignedIn(await session.json());
      }
      lastStatus = data.status;
      // Fetch teammates only while the picker is open and keep its selection if the player is still online.
      if (duo.open && !actions.hidden) {
        const people = await request('/online');
        const selected = picker.value;
        picker.replaceChildren(new Option('Choose an online teammate', ''));
        for (const p of people) picker.add(new Option(`${p.display_name} (${p.rating})`, p.id));
        picker.value = people.some(p => p.id === selected) ? selected : '';
      }
    } catch (error) {
      if (error.status !== 401) {
        status.textContent = `Could not load queue: ${error.message}`;
        return;
      }
      // Clear lobby controls and match details when there is no valid session.
      inviteCodeForm.hidden = actions.hidden = cancel.hidden = scoreForm.hidden = true;
      inviteCodeForm.reset();
      duo.open = false;
      invites.replaceChildren();
      details.replaceChildren();
      message.textContent = '';
      lastStatus = undefined;
      scoreContext = undefined;
      status.textContent = 'Sign in to join a ranked doubles match.';
    }
  }

  // Share a single in-flight refresh across interval ticks and user actions.
  function refresh() {
    polling ??= update().finally(() => { polling = null; });
    return polling;
  }
  inviteCodeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const invite_code = new FormData(inviteCodeForm).get('invite_code');
    await act('/invite-code/verify', { invite_code });
    if (inviteCodeForm.hidden) inviteCodeForm.reset();
  });
  byId('doubles-solo').addEventListener('click', () => act('/queue/solo'));
  cancel.addEventListener('click', () => act('/queue/cancel'));
  byId('doubles-invite').addEventListener('click', () => {
    if (picker.value) act('/invites', { inviteeId: picker.value });
    else message.textContent = 'Choose an online teammate first.';
  });
  duo.addEventListener('toggle', () => { if (duo.open && !acting) refresh(); });
  // Poll every 2 seconds while no action is in progress to keep presence and the lobby state current.
  setInterval(() => { if (!acting) refresh(); }, 2000);
  refresh();
})();
