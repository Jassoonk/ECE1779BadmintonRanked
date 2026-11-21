const loginForm = document.querySelector('#login-form');
const signInButton = document.querySelector('#sign-in');
const loginMessage = document.querySelector('#login-message');
const playerCard = document.querySelector('#player-creation');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const fields = new FormData(loginForm);
  signInButton.disabled = true;
  loginMessage.textContent = 'Signing in…';

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: fields.get('email').trim(),
        password: fields.get('password')
      })
    });

    if (response.status === 401) {
      loginMessage.textContent = 'Email or password is incorrect.';
      return;
    }

    if (response.status !== 204) {
      throw new Error('Sign-in request failed');
    }

    loginForm.reset();
    loginForm.hidden = true;
    playerCard.classList.remove('d-none');
    loginMessage.textContent = 'Signed in.';
  } catch {
    loginMessage.textContent = 'Sign-in is unavailable. Please try again.';
  } finally {
    signInButton.disabled = false;
  }
});

signInButton.disabled = false;
