const form = document.querySelector('#registration-form');
const button = document.querySelector('#register-button');
const message = document.querySelector('#registration-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const fields = new FormData(form);
  button.disabled = true;
  message.textContent = 'Registering…';

  try {
    const response = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: fields.get('email'),
        password: fields.get('password'),
        invite_code: fields.get('invite_code'),
        display_name: fields.get('display_name'),
        starting_rank: fields.get('starting_rank')
      })
    });

    const player = await response.json();

    if (!response.ok) {
      message.textContent = player.error || 'Could not register. Please try again.';
      return;
    }

    message.textContent =
      `Registered ${player.display_name} with a starting rating of ${player.rating}. You can now sign in.`;
    form.reset();
    loadLeaderboard();
  } catch {
    message.textContent = 'Could not confirm registration. Check your connection before trying again.';
  } finally {
    button.disabled = false;
  }
});

button.disabled = false;
