// Keep the doubles lobby's polling and DOM helpers private to this script.
(() => {
  const byId = id => document.getElementById(id);
  const status = byId('doubles-status');
  const message = byId('doubles-message');
  const actions = byId('doubles-actions');
  const cancel = byId('doubles-cancel');
  const invites = byId('doubles-invites');
  const details = byId('doubles-details');
  const duo = byId('duo-queue');
  const picker = byId('doubles-person');
  let lastStatus;
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

  // Render team rosters, then show result controls for the current match state.
  function renderMatch(match, player) {
    const heading = document.createElement('h3');
    heading.className = 'h6';
    heading.textContent = `Match #${match.id}`;
    details.append(heading);
    for (const team of [1, 2]) {
      const line = document.createElement('p');
      const names = match.players.filter(p => p.team === team).map(p => `${p.name} (${p.rating})`);
      line.textContent = `Team ${team}: ${names.join(' + ')}`;
      details.append(line);
    }
    const path = `/matches/${match.id}`;
    if (match.status === 'active') {
      details.append(button('I Won', 'success', path + '/result', { result: 'win' }),
        button('I Lost', 'outline-secondary', path + '/result', { result: 'loss' }));
      return;
    }
    const text = document.createElement('p');
    text.textContent = `Reported winner: Team ${match.proposed_winning_team}. Waiting for the opposing team.`;
    details.append(text);
    // Normalize player IDs because the roster and session can return them in different JSON types.
    const teamOf = id => match.players.find(p => String(p.id) === String(id)).team;
    if (teamOf(player.id) !== teamOf(match.submitted_by)) {
      details.append(button('Confirm result', 'success', path + '/confirm', { decision: 'confirm' }),
        button('Dispute result', 'outline-danger', path + '/confirm', { decision: 'dispute' }));
    }
  }

  // Send a presence heartbeat before reading the latest invitation, queue, or match state.
  async function update() {
    try {
      const { player } = await request('/presence', 'POST');
      const data = await request('/status');
      const incoming = data.invitations?.[0];
      const outgoing = data.outgoing?.[0];
      actions.hidden = data.status !== 'idle' || Boolean(incoming || outgoing);
      cancel.hidden = data.status !== 'waiting';
      if (actions.hidden) duo.open = false;
      invites.replaceChildren();
      details.replaceChildren();

      if (data.match) {
        status.textContent = 'Match found!';
        renderMatch(data.match, player);
      } else if (data.status === 'waiting') {
        status.textContent = `Searching for opponents (${data.mode})...`;
      } else if (incoming) {
        status.textContent = `${incoming.inviter_name} invited you to play doubles.`;
        const path = `/invites/${incoming.id}/respond`;
        invites.append(button('Accept', 'success', path, { decision: 'accept' }),
          button('Decline', 'outline-danger', path, { decision: 'decline' }));
      } else if (outgoing) {
        status.textContent = `Invitation sent to ${outgoing.invitee_name}. Waiting for acceptance.`;
      } else {
        status.textContent = 'Ready to play doubles.';
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
      actions.hidden = cancel.hidden = true;
      duo.open = false;
      invites.replaceChildren();
      details.replaceChildren();
      message.textContent = '';
      lastStatus = undefined;
      status.textContent = 'Sign in to join a ranked doubles match.';
    }
  }

  // Share a single in-flight refresh across interval ticks and user actions.
  function refresh() {
    polling ??= update().finally(() => { polling = null; });
    return polling;
  }
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
