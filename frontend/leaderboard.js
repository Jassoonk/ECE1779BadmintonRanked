const leaderboardBody = document.querySelector('#leaderboard-body');
const leaderboardMessage = document.querySelector('#leaderboard-message');

// Fetch current ratings on page load and when registration or a finished match changes the rankings.
async function loadLeaderboard() {
  leaderboardMessage.textContent = 'Loading leaderboard...';

  try {
    const response = await fetch('/leaderboard', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error('Leaderboard request failed');
    }

    const players = await response.json();

    if (!Array.isArray(players)) {
      throw new Error('Invalid leaderboard response');
    }

    // Build the rows off-screen, then replace the table body in one DOM update.
    const rows = document.createDocumentFragment();

    players.forEach((player, index) => {
      const row = document.createElement('tr');
      const positionCell = document.createElement('td');
      const nameCell = document.createElement('td');
      const ratingCell = document.createElement('td');

      // Use the order supplied by the API to assign leaderboard positions.
      positionCell.textContent = String(index + 1);
      nameCell.textContent = player.display_name;
      ratingCell.textContent = String(player.rating);
      ratingCell.classList.add('text-end');

      row.append(positionCell, nameCell, ratingCell);
      rows.append(row);
    });

    leaderboardBody.replaceChildren(rows);
    leaderboardMessage.textContent = players.length === 0
      ? 'No players yet. Create a player to get started.'
      : '';
  } catch {
    leaderboardMessage.textContent =
      'Could not load leaderboard. Please refresh to try again.';
  }
}

loadLeaderboard();
