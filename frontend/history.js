const container = document.getElementById('match-history');

async function loadHistory() {
  try {
    const response = await fetch('/doubles/history', {
      cache: 'no-store'
    });

    if (!response.ok) throw new Error('Unable to load match history.');

    const { matches } = await response.json();
    container.replaceChildren();

    if (!matches.length) {
      container.textContent = 'No completed matches yet.';
      return;
    }

    for (const match of matches) {
      const card = document.createElement('div');
      card.className = 'border rounded p-3 mb-3';

      const title = document.createElement('h3');
      title.className = 'h6';
      title.textContent =
        `Match #${match.id} - ${new Date(match.completed_at).toLocaleString()}`;
      card.append(title);

      const score = document.createElement('p');
      score.className = 'fw-bold';
      score.textContent =
        `Team 1 ${match.team1_score} - ${match.team2_score} Team 2`;
      card.append(score);

      for (const team of [1, 2]) {
        const line = document.createElement('p');
        line.className = 'mb-1';

        const players = match.players
          .filter(p => p.team === team)
          .map(p => {
            const change = p.after - p.before;
            return `${p.name} (${change >= 0 ? '+' : ''}${change})`;
          });

        line.textContent = `Team ${team}: ${players.join(', ')}`;
        card.append(line);
      }

      container.append(card);
    }
  } catch (error) {
    container.textContent = error.message;
  }
}

loadHistory();
