# TradeSizer

A personal position-size and RR calculator. You determine Entry, Stop Loss
and Take Profit from your chart — TradeSizer calculates the lot size needed
to hit your desired monetary outcome. It never touches your SL/TP to make
the numbers work; the chart levels are always the input, the lot size is
always the output.

No frameworks, no build step, no live price feed. Plain HTML/CSS/JS, run
from a static host with a lightweight backend for cross-device sync.

## Running it locally

Because `index.html` loads ES modules (`<script type="module">`), opening
the file directly (`file://...`) will be blocked by the browser's CORS
rules for modules. Serve it over plain HTTP instead:

```bash
# any static server works, for example:
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL.

> **Note:** The local-only mode runs the frontend without a backend. Instrument
> settings will be read from `localStorage` (stale until you connect a backend).
> To use the full app with login and cross-device sync, you need the backend
> running — see [Deployment](#deployment).

## Running the tests

The calculation engine is a plain, dependency-free JS module with unit
tests written against Node's built-in test runner — no test framework to
install.

```bash
npm test
# equivalent to: node --test src/engine/calculationEngine.test.js
```

The suite covers the worked example from the spec ($100 capital, USDJPY,
Double X mode → 0.15 lots, RR 1:2, ~$50 risk / ~$100 profit) plus the seven
required cases: basic RR/risk math at two ratios, a larger stake, lot size
scaling with SL distance and with pip value, rejection of invalid inputs,
and volume-step rounding.

## How the math works

All of it lives in `src/engine/calculationEngine.js`, in this order, and
the order is load-bearing — it is never reversed:

1. **Distances come from the chart.**
   `SL distance = |Entry − SL|`, `TP distance = |TP − Entry|`, each divided
   by the instrument's pip/tick size to get a unit count.

2. **RR comes from those distances.**
   `RR = TP units / SL units`.

3. **Required risk comes from RR and your desired profit.**
   `Required risk = Desired profit / RR`.

4. **Lot size comes from required risk and the SL distance.**
   `Lot size = Required risk / (SL units × value per unit per 1.00 lot)`.

The theoretical lot size is then rounded to the instrument's configured
volume step and clamped to its min/max lot, because that's what a broker
will actually let you trade. Since rounding shifts the real numbers
slightly, expected loss/profit and capital-after-TP/SL are **recalculated
using the rounded lot size**, not the theoretical one — both figures are
shown on the dashboard so you can see the difference.

**Target modes:**
- *Double X* — desired profit is set automatically to equal your capital
  (a $100 stake targets a $100 profit at TP).
- *Custom profit* — you type the exact number you're targeting.

## Instrument settings — how they work, and where they live

Every instrument's contract specification (unit type, pip/tick size, value
per pip/tick per 1.00 lot, min/max lot, volume step) is **broker-specific
configuration data**, not a hard-coded constant. USDJPY, XAUUSD, and DXY do
not share a calculation convention — the engine only ever uses whatever
values are stored for the selected instrument. Enter the exact numbers from
your broker's MT5 contract specification on the Settings page.

All persistence goes through one file: `src/data/settingsStore.js`. It's
the only place in the codebase that calls `localStorage`. Settings persist
across page refresh and browser restart. Saving is atomic — if any
instrument row fails validation, nothing is written, so you can't end up
with half-saved settings.

Because storage is isolated behind that one module, swapping localStorage
for a real backend later (a database, an API) means rewriting
`settingsStore.js` only. The calculation engine and the UI don't know or
care where the data comes from.

Trade inputs (capital, entry, SL, TP, direction, results) are **not**
persisted — they live only in memory for the current session
(`tradeSession` in `src/app.js`) and reset when you hit Reset or reload the
page. Only instrument configuration is durable.

## Cross-device sync

Instrument settings now sync across all your devices through a small
backend. Here's how it works:

1. **Sign in** with the hardcoded email and password (editable in `server.js`).
2. On successful sign-in, a session token is stored in your browser's
   `localStorage` and the dashboard loads the latest settings from the
   backend.
3. **"Update settings"** writes `settings.json` directly to this GitHub repo
   via the backend's GitHub API proxy — the GitHub personal access token
   never leaves the server.
4. On any other device, sign in and the dashboard fetches the same
   `settings.json` — your instruments are instantly available everywhere.

The sync file is `settings.json` at the repo root. It is the single source
of truth for all devices.

### Adding a new instrument

Two ways:

- **From the UI:** Settings → "Add instrument" → fill in the symbol, unit
  type, pip/tick size, value per pip/tick per 1.00 lot, min lot, max lot,
  and volume step → "Update settings". It shows up in the Dashboard's
  instrument dropdown immediately and syncs to all devices.
- **In code:** add an entry to `SEED_INSTRUMENTS` in
  `src/data/settingsStore.js` if you want it to ship as a default the first
  time the app runs on a fresh browser.

No other file needs to change — the dropdown, the settings table, and the
calculation engine are all driven by the stored instrument list.

## Login

Every session starts with a sign-in screen. Credentials are checked
against values hard-coded in `server.js` (not in the browser — the
browser only ever sees a session token). To change your credentials,
edit the two lines at the top of `server.js`:

```js
const APP_EMAIL    = process.env.APP_EMAIL    || 'your-email@example.com';
const APP_PASSWORD = process.env.APP_PASSWORD || 'your-password';
```

Alternatively, set the same values as environment variables
(`APP_EMAIL`, `APP_PASSWORD`) — env vars take precedence over the
hard-coded defaults.

## Button feedback (vibration + toast)

Every button press (Calculate, Reset, Update settings, Add/Remove
instrument, Dashboard/Settings nav, Direction/Target mode toggles,
Sign in, Sign out) gives two kinds of confirmation:

- **Vibration**, via the browser's [Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
  (`navigator.vibrate`) — a short buzz for success/neutral actions, a
  double buzz for errors. This only works on browsers that implement the
  API, mainly **Android Chrome**. **iOS Safari does not support vibration
  at all** (Apple has never implemented the API), so on iPhone you won't
  feel anything — that's a platform limitation, not a bug.
- **A toast popup** at the bottom of the screen, which works identically
  on every device and browser, including iPhone. This is the reliable
  confirmation to rely on cross-platform.

Both live in `src/app.js` (`vibrate()` and `showToast()`) and in
`styles.css` (`.toast`). To change the wording, duration, or vibration
pattern, edit the `vibrate(...)`/`showToast(...)` calls next to each
button's event listener.

## Changing the styling

Everything visual is in `styles.css`, driven by CSS custom properties at
the top of the file (`--bg`, `--surface`, `--amber`, `--font-num`, etc.).
Change a token there and it propagates everywhere. The layout is a plain
CSS grid (`.shell`, `.board`) with a mobile breakpoint at 720px and a
tablet breakpoint at 980px — no component library, so any part of the
markup in `index.html` can be restyled directly.

## Deploying it

The app has two parts: the **static frontend** (GitHub Pages) and a
**backend server** that handles login and proxies the GitHub API.

### Frontend — GitHub Pages

Same as before:

1. Commit `index.html`, `styles.css`, `src/`, `settings.json`, and
   `server.js` to a GitHub repo.
2. Repo → Settings → Pages → Deploy from branch → pick `main` (or
   whichever branch) and the root folder.
3. GitHub Pages serves static files over HTTPS by default.

### Backend — where to run it

The backend (`server.js`) is a Node.js Express server. It **cannot**
run on GitHub Pages (static-only), so it needs a separate host.

**Recommended: [Railway](https://railway.app)** (no free-hour cap, generous
free tier) or [Render](https://render.com). Both support Node.js apps and
environment variables.

Railway setup:
1. Push this repo to GitHub.
2. On Railway → New Project → "Deploy from GitHub repo" → pick this repo.
3. Add these environment variables in Railway's dashboard:
   - `APP_EMAIL` — your sign-in email
   - `APP_PASSWORD` — your sign-in password
   - `GITHUB_PAT` — a GitHub personal access token with `repo` scope
   - `REPO_OWNER` — your GitHub username (default: `cooljoe623`)
   - `REPO_NAME` — the repo name (default: `tradesizer`)
4. Railway gives you a public URL. Point the `API_BASE` in `src/api.js`
   to that URL (or leave it as `''` if you serve the frontend from the
   same host).

Render setup is identical — New Web Service → Deploy from GitHub → set
the env vars above.

**Important:** The `GITHUB_PAT` must have `repo` scope (full control of
private repos, or at least `contents:write` for this repo) so the backend
can read and write `settings.json` via the GitHub REST API.

### Local deployment (quick test)

```bash
npm install
GITHUB_PAT=ghp_... APP_EMAIL=you@example.com APP_PASSWORD=secret npm start
```

Then open `http://localhost:3000`. The backend serves the static files
and handles API requests on the same origin, so CORS is not an issue.

## Project structure

```
tradesizer/
├── index.html                       # markup — dashboard + settings + login screen
├── styles.css                       # all visual design, token-driven
├── settings.json                    # synced instrument data (single source of truth)
├── server.js                        # Express backend: login + GitHub API proxy
├── package.json                     # `npm test` + `npm start` (express + node-fetch)
└── src/
    ├── app.js                       # DOM wiring, event handlers, rendering, auth gate
    ├── api.js                       # frontend API client (fetch → backend)
    ├── login.js                     # login form builder, sign-in / sign-out
    ├── engine/
    │   ├── calculationEngine.js     # pure math — no DOM, no storage
    │   └── calculationEngine.test.js
    └── data/
        └── settingsStore.js         # local cache layer (localStorage)
```

## What's deliberately NOT in v1

Per the spec: no live price feed, no journaling, no multi-broker profiles,
no spread/commission/swap/slippage modeling, no crypto/indices
beyond DXY. The engine and data layer are structured so none of these
require rebuilding the calculator — costs, for instance, would slot in as
extra fields on the instrument settings and an extra term in
`calculateTrade`, without touching the RR-first ordering described above.
