# GTM Fit Analyzer

Portfolio GTM demo: enter a company domain and ICP profile, run an n8n-orchestrated analysis, and display a transparent fit score plus sales strategy.

**Planned live demo:** [gtm-demo.marvinlossa.com](https://gtm-demo.marvinlossa.com)

## Product flow

1. **Enter** — domain/URL + profile (Sales Expansion, PLG, Enterprise IT).
2. **Analysis** — n8n runs Perplexity research + OpenRouter strategy; app polls SQLite.
3. **Results** — fit score, per-attribute evidence, sales strategy, workflow panel.

## UI

Visual design is intentionally aligned with [Content Brief Creator](https://content-brief-creator.marvinlossa.com):

- Dark `#09110f` shell with cyan/amber radial gradients (`slideBackground`)
- Geist + Geist Mono, amber focus rings, cyan mono stage labels
- Full-viewport snap stages + left stage rail
- Pill nav, white→amber primary CTAs, rounded glass panels

## Stack

- Next.js 16 / React 19 / TypeScript / Tailwind 4
- SQLite (better-sqlite3) on Railway volume
- n8n orchestration
- Perplexity (research) + OpenRouter (`x-ai/grok-4.3` strategy)
- Cloudflare Turnstile

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current status

**PR 1 — scaffold:** CBC UI shell, stages, sample results, workflow panel  
**PR 1.5 — SQLite:** `better-sqlite3`, `GET /api/health` DB probe, Dockerfile  
**PR 2 — demo gate:** Turnstile + SQLite daily IP limit + public URL guards  
**PR 3 — profiles:** full schema, 3 seed JSON files, `GET /api/profiles`  
**PR 4 — scoring:** deterministic `scoring.v1` + unit tests  
**PR 5+6 — jobs API:** create / poll / callback, mock n8n, timeout recovery  
**PR 7 — n8n:** workflow export, docker-compose, live orchestration path  

Still ahead: Railway multi-service deploy, portfolio card, hardening.

### Jobs (local mock)

```bash
# MOCK_N8N=1 (default) auto-completes after ~1.5s
curl -s -X POST localhost:3000/api/jobs \
  -H 'content-type: application/json' \
  -d '{"domain":"acme.com","profileId":"sales-expansion","turnstileToken":""}'
# → { jobId, status: "running", pollAfterMs: 2000 }
curl -s localhost:3000/api/jobs/<jobId>
```

### Live n8n (optional)

```bash
export PERPLEXITY_API_KEY=...
export OPENROUTER_API_KEY=...
docker compose up n8n
# Import n8n/workflows/gtm-fit-analysis.json → Activate → copy Production webhook URL
```

`.env.local`:

```bash
MOCK_N8N=0
N8N_WEBHOOK_URL=http://localhost:5678/webhook/gtm-fit-analysis
GTM_WEBHOOK_SECRET=dev-webhook-secret
GTM_CALLBACK_SECRET=dev-callback-secret
APP_PUBLIC_URL=http://host.docker.internal:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Full steps: [n8n/README.md](./n8n/README.md).

### Health check

```bash
curl -s http://localhost:3000/api/health | jq
# { ok, database: { ok, path, driver: "better-sqlite3" } }
```

### Intake gate

```bash
curl -s -X POST http://localhost:3000/api/intake/gate \
  -H 'content-type: application/json' \
  -d '{"domain":"acme.com","turnstileToken":""}'
```

Without `TURNSTILE_SECRET_KEY`, non-production allows empty tokens (local dev).

## Design

See `/home/comfymaster/gtm-fit-analyzer-design.md` for the full systems design.
