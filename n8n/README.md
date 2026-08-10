# n8n — GTM Fit Analysis workflow

Pinned image: **`n8nio/n8n:1.103.0`** (see root `docker-compose.yml`).

Workflow export: [`workflows/gtm-fit-analysis.json`](./workflows/gtm-fit-analysis.json)

## Flow

```
Webhook (Respond Immediately)
  → Validate secret + build research prompt
  → Progress callback (stage=research)
  → Perplexity Agent API
  → Parse & normalize findings
  → Progress callback (stage=strategy)
  → OpenRouter strategy (JSON schema)
  → Assemble complete body
  → App callback (Bearer GTM_CALLBACK_SECRET)
```

Error branches call the app with `{ status: "failed", error, executionId }` for auth, research, and strategy failures.

## Quick start (local)

### 1. Start n8n

From the repo root:

```bash
# Optional: export provider keys in your shell or a root .env for compose
export PERPLEXITY_API_KEY=pplx-...
export OPENROUTER_API_KEY=sk-or-...
export GTM_WEBHOOK_SECRET=dev-webhook-secret
export GTM_CALLBACK_SECRET=dev-callback-secret

docker compose up n8n
```

Open [http://localhost:5678](http://localhost:5678) — basic auth default `admin` / `admin`.

### 2. Import workflow

1. **Workflows → Import from File**
2. Select `n8n/workflows/gtm-fit-analysis.json`
3. Open the **Perplexity Agent** HTTP node:
   - Add **Header Auth** credential: name `Authorization`, value `Bearer <PERPLEXITY_API_KEY>`  
     *or* set a fixed header if you prefer env-only setups
4. Confirm **Webhook** node:
   - Path: `gtm-fit-analysis`
   - **Respond**: `Immediately` / `When Received` (`responseMode: onReceived`)
5. **Activate** the workflow (toggle Active)

### 3. Copy production webhook URL

Use the **Production** URL (not Test), e.g.:

```text
http://localhost:5678/webhook/gtm-fit-analysis
```

### 4. Configure the Next.js app

`.env.local`:

```bash
MOCK_N8N=0
N8N_WEBHOOK_URL=http://localhost:5678/webhook/gtm-fit-analysis
GTM_WEBHOOK_SECRET=dev-webhook-secret
GTM_CALLBACK_SECRET=dev-callback-secret
# URL the *browser* uses; also used when building callback URLs sent to n8n
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_PUBLIC_URL=http://host.docker.internal:3000
```

**Important:** `callbackUrl` is built by the app from `NEXT_PUBLIC_APP_URL` / `APP_PUBLIC_URL`.  
n8n runs in Docker and must reach the host app:

| Host OS | Suggested `APP_PUBLIC_URL` for callback base |
| --- | --- |
| Docker Desktop (Mac/Win) | `http://host.docker.internal:3000` |
| Linux | `http://host.docker.internal:3000` (compose sets `extra_hosts`) or `http://172.17.0.1:3000` |

If the app sets `NEXT_PUBLIC_APP_URL=http://localhost:3000`, n8n will try to call `localhost` *inside* the container and fail. Prefer:

```bash
# App builds callback as host.docker.internal so n8n can reach Next on the host
APP_PUBLIC_URL=http://host.docker.internal:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`buildCallbackUrl` prefers `NEXT_PUBLIC_APP_URL` then `APP_PUBLIC_URL`. For local n8n, set **`NEXT_PUBLIC_APP_URL=http://host.docker.internal:3000`** *or* adjust `buildCallbackUrl` priority — see note below.

> **Callback base:** the app currently uses `NEXT_PUBLIC_APP_URL` first. For Docker n8n, set:
>
> ```bash
> NEXT_PUBLIC_APP_URL=http://host.docker.internal:3000
> ```
>
> in `.env.local` while testing with compose (browser can still open `http://localhost:3000`).

### 5. Run the app without mock

```bash
npm run dev
```

Submit a domain on the Enter stage. You should see stage progress (`research` → `strategy`) via progress callbacks, then a scored result.

## Environment variables (n8n service)

| Variable | Purpose |
| --- | --- |
| `GTM_WEBHOOK_SECRET` | Must match app; checked before Perplexity |
| `GTM_CALLBACK_SECRET` | Bearer token for app callback |
| `PERPLEXITY_API_KEY` | Research (prefer Header Auth credential on node) |
| `PERPLEXITY_RESEARCH_MODEL` | Default `perplexity/sonar` |
| `OPENROUTER_API_KEY` | Strategy LLM |
| `OPENROUTER_STRATEGY_MODEL` | Default `x-ai/grok-4.3` |
| `APP_PUBLIC_URL` | Referer / docs |
| `N8N_CONCURRENCY_PRODUCTION` | `2` (keep under app `MAX_INFLIGHT_JOBS=3`) |

## Secrets matrix

| Secret | App | n8n |
| --- | --- | --- |
| `GTM_WEBHOOK_SECRET` | yes (trigger header + body) | yes (validate) |
| `GTM_CALLBACK_SECRET` | yes (verify callback) | yes (send callback) |
| `PERPLEXITY_API_KEY` | **no** (prod) | yes |
| `OPENROUTER_API_KEY` | **no** (prod) | yes |
| Turnstile | yes | no |

## Webhook contract (app → n8n)

`POST` JSON:

```json
{
  "jobId": "uuid",
  "domain": "acme.com",
  "normalizedUrl": "https://acme.com",
  "profileId": "sales-expansion",
  "profile": { "...": "full profile" },
  "attributes": [ { "id", "label", "weight", "researchPrompt", "positiveSignals", "negativeSignals" } ],
  "callbackUrl": "http://host.docker.internal:3000/api/jobs/{jobId}/callback",
  "gtmWebhookSecret": "same as GTM_WEBHOOK_SECRET"
}
```

Headers:

- `X-Gtm-Webhook-Secret: <GTM_WEBHOOK_SECRET>`
- `Content-Type: application/json`

## Callback contract (n8n → app)

See design doc. Summary:

- Progress: `{ "status": "running", "stage": "research"|"strategy", "executionId" }`
- Complete: `{ "status": "complete", "findings": [...], "strategy": {...}, "executionId", "meta" }`
- Failed: `{ "status": "failed", "error": "RESEARCH_JSON_PARSE|...", "executionId" }`
- Auth: `Authorization: Bearer <GTM_CALLBACK_SECRET>`

## Railway notes

1. Service `n8n` from image `n8nio/n8n` (or pin `:1.103.0` / `:latest`) with **start command** `n8n` (not bare `start` — Railway may drop the image entrypoint).
2. **Volume caution:** mounting a Railway volume over `/home/node/.n8n` often causes `EACCES` (volume root-owned, n8n runs as `node`). Prefer no volume first, or mount at `/data` with a root entrypoint that `chown`s before `exec n8n`, and set `N8N_USER_FOLDER=/data`.
3. Private networking for app → webhook if available; public URL for the editor.
4. Set the same secrets as above; never put Perplexity/OpenRouter keys on the app service.
5. App `N8N_WEBHOOK_URL` = internal `http://n8n.railway.internal:.../webhook/gtm-fit-analysis` or public production webhook URL when `MOCK_N8N=0`.
6. App public URL = `https://gtm-demo.marvinlossa.com` (plus Railway default domain).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Job fails `N8N_TRIGGER_FAILED` | Workflow inactive; wrong webhook URL (use Production); secret mismatch |
| Job stuck `running` | Callback URL not reachable from container; check `host.docker.internal` / firewall |
| `RESEARCH_JSON_PARSE` | Model returned non-JSON; check Perplexity response in n8n execution log |
| `401` on callback | `GTM_CALLBACK_SECRET` mismatch |
| Expensive runaway | Confirm `N8N_CONCURRENCY_PRODUCTION=2` and app daily limit |

## Mock vs live

| Mode | App env | Behavior |
| --- | --- | --- |
| Mock (default) | `MOCK_N8N=1` | No n8n; local timed complete |
| Live | `MOCK_N8N=0` + `N8N_WEBHOOK_URL` | Full Perplexity + OpenRouter path |
