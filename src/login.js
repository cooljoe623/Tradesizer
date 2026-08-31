/**
 * src/login.js
 *
 * Builds the login form inside #login-screen and wires up login/logout.
 */

import { login, logout, isLoggedIn } from './api.js';

const HAPTIC_OK = 12;
const HAPTIC_ERROR = [15, 60, 15];

function vibrate(pattern = HAPTIC_OK) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

function showToast(message, variant = 'default') {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  clearTimeout(toastEl._timeout);
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.className = `toast toast--${variant}`;
  void toastEl.offsetWidth;
  toastEl.classList.add('is-visible');
  toastEl._timeout = setTimeout(() => {
    toastEl.classList.remove('is-visible');
    setTimeout(() => { toastEl.hidden = true; }, 200);
  }, 2200);
}

function buildLoginForm() {
  const screen = document.getElementById('login-screen');
  if (!screen) return;

  const form = document.createElement('form');
  form.className = 'login-form';
  form.setAttribute('novalidate', '');
  form.innerHTML = `
    <h2 class="login-form__title">TradeSizer</h2>
    <p class="login-form__subtitle">Sign in to continue</p>
    <div class="field">
      <label for="login-email">Email</label>
      <input id="login-email" type="email" placeholder="user@example.com" required autocomplete="email" />
    </div>
    <div class="field">
      <label for="login-password">Password</label>
      <input id="login-password" type="password" placeholder="Enter password" required autocomplete="current-password" />
    </div>
    <button type="submit" class="btn btn--primary login-form__btn">Sign in</button>
    <p class="login-form__error" id="login-error" hidden></p>
  `;
  screen.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    vibrate(HAPTIC_OK);
    try {
      const result = await login(email, password);
      if (result.ok) {
        showToast('Signed in', 'success');
        form.remove();
        onLogin();
      }
    } catch (err) {
      vibrate(HAPTIC_ERROR);
      const errEl = document.getElementById('login-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
      showToast('Sign-in failed', 'error');
    }
  });
}

export function initLogin() {
  if (isLoggedIn()) {
    onLogin();
  } else {
    showLoginScreen();
    buildLoginForm();
  }
}

export function showLoginScreen() {
  const shell = document.querySelector('.shell');
  const loginScreen = document.getElementById('login-screen');
  if (shell) shell.style.display = 'none';
  if (loginScreen) loginScreen.style.display = 'flex';
}

export function hideLoginScreen() {
  const shell = document.querySelector('.shell');
  const loginScreen = document.getElementById('login-screen');
  if (shell) shell.style.display = '';
  if (loginScreen) loginScreen.style.display = 'none';
}

export async function handleLogout() {
  await logout();
  showLoginScreen();
  buildLoginForm();
  showToast('Signed out');
  window.dispatchEvent(new Event('ts-logout'));
}

function onLogin() {
  hideLoginScreen();
  // Notify app.js that login succeeded so it can load settings.
  window.dispatchEvent(new Event('ts-login'));
}
