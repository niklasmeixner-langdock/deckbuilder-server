# Deck Builder Bridge Server

A tiny Express + WebSocket bridge between Langdock and the Figma Deck Builder plugin.

```
Langdock Agent ──HTTP POST──▶ Railway server ──WebSocket──▶ Figma plugin
                              (this repo)                   (always-on)
```

Figma plugins can't accept inbound HTTP, so the plugin opens a WebSocket to this
server and listens. Langdock POSTs the deck spec to `POST /spec` with an
`x-api-key` header, the server validates it and pushes the spec to every
connected plugin client.

## Endpoints

| Method | Path     | Purpose                                                        |
| ------ | -------- | -------------------------------------------------------------- |
| GET    | `/`      | Health check. Returns `{ ok: true, clients: <connected ws> }`. |
| POST   | `/spec`  | Dispatch a deck spec to all connected plugin clients.          |
| WS     | `/`      | Plugin clients connect here.                                   |

`POST /spec` headers:

- `x-api-key: <your API_KEY>` — required
- `Content-Type: application/json`

Body: a deck spec object with at least `pageName` (string) and `slides` (array).

Responses:

- `200 { ok: true, clientsNotified: <n> }` — dispatched
- `400 { error: "Invalid spec — ..." }` — bad payload
- `401 { error: "Invalid API key" }` — wrong / missing header
- `503 { error: "No plugin clients connected..." }` — plugin not running

## Local development

```bash
cp .env.example .env
# Edit .env and set API_KEY to any long random string
npm install
npm start
```

Test it:

```bash
curl http://localhost:3000/                          # → { "ok": true, "clients": 0 }

curl -X POST http://localhost:3000/spec \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pageName":"Test","slides":[{"name":"x","source":"824:6671"}]}'
# → 503 until you open the Figma plugin and connect it to ws://localhost:3000
```

## Deploy to Railway via GitHub

### 1. Push this folder to GitHub

```bash
cd railway-server
git init
git add .
git commit -m "Initial deck builder bridge"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

### 2. Create a Railway project

1. Open <https://railway.app/new> and pick **Deploy from GitHub repo**.
2. Authorize Railway to read the repo if you haven't already.
3. Select the repo. Railway detects `package.json` and `railway.toml`
   and provisions a Node service automatically.

### 3. Set the API key environment variable

1. In the Railway project, click the service → **Variables**.
2. Add `API_KEY` and paste a long random string. Save.
   ```bash
   # Generate one locally:
   openssl rand -hex 32
   ```
3. Railway redeploys automatically. **Do not commit this value.**

### 4. Generate a public URL

1. In the service → **Settings** → **Networking** → **Generate Domain**.
2. You'll get something like `https://deckbuilder-server-production.up.railway.app`.
3. Verify it's live:
   ```bash
   curl https://<your-railway-domain>/
   # → { "ok": true, "clients": 0 }
   ```

### 5. Note the WebSocket URL

The plugin connects over WebSocket. Use the same domain with `wss://`:

```
wss://<your-railway-domain>
```

Keep both the HTTPS URL (for Langdock) and the WSS URL (for the Figma plugin)
handy — you'll paste them into the next two setup steps.

## Updating

Push to `main`. Railway auto-deploys.

## Troubleshooting

- **`401 Invalid API key`** — header name is `x-api-key`, value must match
  the env var exactly. Check for stray spaces or trailing newlines.
- **`503 No plugin clients connected`** — open Figma, run the plugin, click
  Connect. Confirm the status pill says "Live".
- **Plugin shows "Disconnected" and won't reconnect** — Railway sleeps free
  services after inactivity. The plugin auto-retries every 5 s; just leave
  it open or upgrade to a paid Railway plan.
- **CORS errors from Langdock** — the Langdock sandbox calls server-side via
  `ld.request`, so CORS doesn't apply. If you see CORS errors you're calling
  from a browser, not from a Langdock action.
