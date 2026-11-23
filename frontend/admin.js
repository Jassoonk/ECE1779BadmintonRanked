// Wire the admin page to the password check, health endpoints, and player list.
const adminForm = document.querySelector('#admin-login-form');
const adminFields = document.querySelector('#admin-login-fields');
const adminMessage = document.querySelector('#admin-login-message');
const adminDashboard = document.querySelector('#admin-dashboard');
const appStatus = document.querySelector('#admin-app-status');
const dbStatus = document.querySelector('#admin-db-status');
const playersBody = document.querySelector('#admin-players-body');
const playersMessage = document.querySelector('#admin-players-message');
const inviteForm = document.querySelector('#admin-invite-form');
const inviteMessage = document.querySelector('#admin-invite-message');
let adminToken;

// Show each endpoint's current health and cap how long the browser waits for a response.
async function checkHealth(path, statusElement) {
  statusElement.textContent = 'Checking…';

  try {
    const response = await fetch(path, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });
    statusElement.textContent = response.ok ? 'Healthy' : 'Unavailable';
  } catch {
    statusElement.textContent = 'Unavailable';
  }
}

// Reuse leaderboard data to populate the dashboard's player table.
async function loadAdminPlayers() {
  playersMessage.textContent = 'Loading players…';

  try {
    const response = await fetch('/leaderboard', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error('Could not load players.');
    }

    const players = await response.json();
    const rows = document.createDocumentFragment();

    for (const player of players) {
      const row = document.createElement('tr');
      row.insertCell().textContent = player.display_name;

      const ratingCell = row.insertCell();
      ratingCell.textContent = player.rating;
      ratingCell.classList.add('text-end');

      rows.append(row);
    }

    playersBody.replaceChildren(rows);
    playersMessage.textContent = players.length === 0 ? 'No players yet.' : '';
  } catch {
    playersBody.replaceChildren();
    playersMessage.textContent = 'Could not load players. Please try again.';
  }
}

// Send the password as JSON and keep dashboard controls hidden during verification.
adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const password = new FormData(adminForm).get('password');
  adminFields.disabled = true;
  adminDashboard.hidden = true;
  adminMessage.textContent = 'Checking password…';

  try {
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const result = await response.json();

    if (response.ok) {
      adminToken = result.token;
      adminMessage.textContent = result.message;
      adminForm.reset();
      adminDashboard.hidden = false;

      // Load the two health checks and the player list independently after the password is accepted.
      await Promise.all([
        checkHealth('/health', appStatus),
        checkHealth('/db-health', dbStatus),
        loadAdminPlayers()
      ]);
    } else {
      adminMessage.textContent = result.error || 'Could not check the password.';
    }
  } catch {
    adminMessage.textContent = 'Could not reach the server. Please try again.';
  } finally {
    adminFields.disabled = false;
  }
});

inviteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = inviteForm.querySelector('button[type="submit"]');
  const invite_code = new FormData(inviteForm).get('invite_code');
  submit.disabled = true;
  inviteMessage.textContent = 'Saving invite code...';

  try {
    const response = await fetch('/admin/invite-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + adminToken
      },
      body: JSON.stringify({ invite_code })
    });
    const result = await response.json();
    inviteMessage.textContent = response.ok ? result.message : result.error;
    if (response.ok) inviteForm.reset();
  } catch {
    inviteMessage.textContent = 'Could not save the invite code. Please try again.';
  } finally {
    submit.disabled = false;
  }
});

// Enable the form after its JavaScript submit handler is installed.
adminFields.disabled = false;
adminMessage.textContent = '';
