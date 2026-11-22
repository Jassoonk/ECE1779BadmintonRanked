const adminForm = document.querySelector('#admin-login-form');
const adminFields = document.querySelector('#admin-login-fields');
const adminMessage = document.querySelector('#admin-login-message');
const adminDashboard = document.querySelector('#admin-dashboard');
const appStatus = document.querySelector('#admin-app-status');
const dbStatus = document.querySelector('#admin-db-status');
const playersBody = document.querySelector('#admin-players-body');
const playersMessage = document.querySelector('#admin-players-message');

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
      adminMessage.textContent = result.message;
      adminForm.reset();
      adminDashboard.hidden = false;

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

adminFields.disabled = false;
adminMessage.textContent = '';
