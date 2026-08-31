/**
 * src/api.js
 *
 * Frontend API client for the TradeSizer backend.
 *
 * All calls go through the backend, which proxies to the GitHub API.
 * The GitHub PAT never leaves the server.
 */

const API_BASE = ''; // Same-origin when backend serves the static files.
// If backend runs on a different host, set: const API_BASE = 'https://your-backend-url.com';

async function request(path, options = {}) {
  const token = localStorage.getItem('ts_session');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export async function login(email, password) {
  const data = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem('ts_session', data.token);
  return { ok: true, token: data.token };
}

export async function logout() {
  try {
    await request('/api/logout', { method: 'POST' });
  } catch {
    // Best-effort; invalidate locally regardless.
  }
  localStorage.removeItem('ts_session');
  return { ok: true };
}

export async function fetchSettings() {
  const data = await request('/api/settings', { method: 'GET' });
  return { ok: true, settings: data.settings };
}

export async function saveSettings(settings) {
  const data = await request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  return { ok: true };
}

export function isLoggedIn() {
  return localStorage.getItem('ts_session') !== null;
}
