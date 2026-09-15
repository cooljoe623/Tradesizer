/**
 * server.js
 *
 * Express backend for TradeSizer.
 *
 * Handles login (hardcoded credentials) and proxies read/write of the
 * settings file stored in this GitHub repo via the GitHub REST API.
 *
 * Edit these four constants to configure the app for your environment.
 */

import express from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration – edit these lines ───────────────────────────────────────
const APP_EMAIL    = process.env.APP_EMAIL    || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const GITHUB_PAT   = process.env.GITHUB_PAT   || '';          // GitHub personal access token
const REPO_OWNER  = process.env.REPO_OWNER  || 'cooljoe623';
const REPO_NAME   = process.env.REPO_NAME   || 'tradesizer';
// ───────────────────────────────────────────────────────────────────────────

const SETTINGS_FILE = 'settings.json';
const GITHUB_API    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;
const PORT          = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// ── PWA-specific routes (MIME types + caching headers) ───────────────
app.get('/manifest.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  // Service worker must be served from the root scope with the correct MIME type.
  // No-cache so the latest version is always fetched.
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(__dirname, 'sw.js'));
});

// Serve static frontend files (index.html, styles.css, src/*, icons/*, settings.json)
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    if (path.endsWith('.png')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// ── In-memory session store: token → { email, expires } ────────────────────
const sessions = new Map();
const TOKEN_BYTES = 32;

function generateToken() {
  const arr = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(arr);
  return Buffer.from(arr).toString('base64url');
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires < now) sessions.delete(token);
  }
}
setInterval(pruneSessions, 60_000);

// ── Auth middleware ────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Missing or malformed Authorization header' });
  }
  const token = header.slice(7);
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ ok: false, error: 'Session expired or invalid' });
  }
  req.token = token;
  req.user = session.email;
  next();
}

// ── POST /api/login ────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (email !== APP_EMAIL || password !== APP_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Invalid email or password' });
  }
  const token = generateToken();
  sessions.set(token, { email, expires: Date.now() + 24 * 60 * 60 * 1000 });
  res.json({ ok: true, token });
});

// ── POST /api/logout ───────────────────────────────────────────────────────
app.post('/api/logout', auth, (_req, res) => {
  sessions.delete(_req.token);
  res.json({ ok: true });
});

// ── GitHub API helper ──────────────────────────────────────────────────────
async function githubRequest(method, path, body) {
  if (!GITHUB_PAT) {
    throw new Error('GITHUB_PAT is not set. Set it in server.js or as an environment variable.');
  }
  const url = `${GITHUB_API}${path}`;
  const options = {
    method,
    headers: {
      Authorization: `token ${GITHUB_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`GitHub API ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ''}`);
  }
  return response.json();
}

// ── GET /api/settings ──────────────────────────────────────────────────────
app.get('/api/settings', auth, async (_req, res) => {
  try {
    const data = await githubRequest('GET', `/${SETTINGS_FILE}`);
    const settings = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /api/settings ──────────────────────────────────────────────────────
app.put('/api/settings', auth, async (req, res) => {
  const { settings } = req.body ?? {};
  if (!Array.isArray(settings)) {
    return res.status(400).json({ ok: false, error: 'settings must be an array' });
  }
  try {
    const sha = await githubRequest('GET', `/${SETTINGS_FILE}`).then((d) => d.sha);
    await githubRequest('PUT', `/${SETTINGS_FILE}`, {
      message: 'Update instrument settings',
      content: Buffer.from(JSON.stringify(settings, null, 2)).toString('base64'),
      sha,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TradeSizer backend running on http://localhost:${PORT}`);
  console.log(`Login credentials: ${APP_EMAIL} / ${APP_PASSWORD}`);
});
