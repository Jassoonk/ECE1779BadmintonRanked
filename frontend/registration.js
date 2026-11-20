const form = document.querySelector('#player-form');
const nameInput = document.querySelector('#display-name');
const button = document.querySelector('#create-player');
const message = document.querySelector('#player-message');

button.disabled = false;

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const displayName = nameInput.value.trim();
  const startingRank = new FormData(form).get('starting_rank');

  if (!displayName) {
    message.textContent = 'Please enter a display name.';
    return;
  }

  if (!startingRank) {
    message.textContent = 'Please choose a starting rank.';
    return;
  }

  button.disabled = true;
  message.textContent = 'Creating player…';

  try {
    const response = await fetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, starting_rank: startingRank })
    });

    const result = await response.json();

    if (!response.ok) {
      message.textContent = result.error || 'Could not create player.';
      return;
    }

    message.textContent =
      `Created ${result.display_name}! Starting rating: ${result.rating}.`;

    form.reset();
  } catch {
    message.textContent =
      'Could not confirm player creation. Check your connection before trying again.';
  } finally {
    button.disabled = false;
  }
});
