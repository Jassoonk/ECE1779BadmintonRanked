const signInForm = document.querySelector('#sign-in-form');
const signInButton = document.querySelector('#sign-in-button');
const signInMessage = document.querySelector('#sign-in-message');
const registrationCard = document.querySelector('#registration-card');

function showSignedIn(player) {
  signInForm.reset();
  signInForm.hidden = true;
  registrationCard.classList.add('d-none');
  signInMessage.textContent = `Signed in as ${player.display_name}. Rating: ${player.rating}.`;
}

async function restoreSession() {
  try {
    const response = await fetch('/auth/session', { cache: 'no-store' });

    if (response.ok) {
      showSignedIn(await response.json());
    } else if (response.status !== 401) {
      signInMessage.textContent = 'Could not check your session.';
    }
  } catch {
    signInMessage.textContent = 'Could not check your session.';
  } finally {
    signInButton.disabled = false;
  }
}

signInForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const fields = new FormData(signInForm);
  signInButton.disabled = true;
  signInMessage.textContent = 'Signing in…';

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') })
    });

    const player = await response.json();

    if (response.ok) {
      showSignedIn(player);
    } else {
      signInMessage.textContent = player.error || 'Could not sign in.';
    }
  } catch {
    signInMessage.textContent = 'Could not sign in. Please try again.';
  } finally {
    signInButton.disabled = false;
  }
});

restoreSession();
