# CNU Meal Rating

GitHub Pages + Cloudflare Worker/D1 app for viewing today's CNU meals and rating each meal with 1-5 stars.

## Features

- Today-only meal view (Korean + English)
- 1-5 star one-shot rating per meal per vote day
- Vote day boundary at 04:00 KST
- Weighted leaderboard (Bayesian-style)
- Daily sync from CNU source at 05:30 KST
- Manual sync via GitHub Actions `workflow_dispatch`

## Project Layout

- `frontend/` GitHub Pages static site
- `worker/` Cloudflare Worker API + D1 schema/migrations
- `scripts/` CNU scraper and payload ingester
- `tests/parser/` parser tests
- `tests/worker/` worker logic tests

## Prerequisites

- Node.js 20+
- Python 3.11+
- Cloudflare account with Workers + D1

## Local Setup

1. Install Node dependencies:

```bash
npm install
```

2. Install Python dependencies:

```bash
pip install -r scripts/requirements.txt
```

3. Create D1 database (once) and copy database id:

```bash
npx wrangler d1 create cnu-meal
```

4. Set `worker/wrangler.toml` database id:

- Replace `REPLACE_WITH_D1_DATABASE_ID` with your D1 database id.

5. Apply migration:

```bash
npx wrangler d1 migrations apply DB --local --config worker/wrangler.toml
```

6. Set Worker secrets:

```bash
npx wrangler secret put SYNC_ADMIN_TOKEN --config worker/wrangler.toml
npx wrangler secret put DEVICE_SALT --config worker/wrangler.toml
npx wrangler secret put IP_SALT --config worker/wrangler.toml
```

7. Optional: lock CORS origin:

- Set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your GitHub Pages origin (for example, `https://<username>.github.io`).

8. Start Worker locally:

```bash
npm run worker:dev
```

9. Point frontend to API:

- Edit `frontend/config.js` and set `API_BASE_URL` to your Worker URL.

## Sync Script

Dry-run without ingest:

```bash
python scripts/sync_menu.py --date 2026-03-03 --dry-run
```

Ingest to worker:

```bash
WORKER_URL="https://<worker>.workers.dev" \
SYNC_ADMIN_TOKEN="<token>" \
python scripts/sync_menu.py --date 2026-03-03 --run-type manual
```

## Cloudflare Dashboard Setup (GitHub Integration)

When creating the Worker project from the Cloudflare UI with connected GitHub repo, use these exact values:

- Project name: `cnu_meal`
- Production branch: `main`
- Build command: leave blank (Cloudflare already installs dependencies automatically). If you must set one, use:

```bash
npm ci
```

- Deploy command:

```bash
sed -i "s/REPLACE_WITH_D1_DATABASE_ID/$CF_D1_DATABASE_ID/" worker/wrangler.toml && npx wrangler d1 migrations apply DB --remote --config worker/wrangler.toml && npx wrangler deploy --config worker/wrangler.toml
```

- Builds for non-production branches: enabled
- Non-production branch deploy command:

```bash
sed -i "s/REPLACE_WITH_D1_DATABASE_ID/$CF_D1_DATABASE_ID/" worker/wrangler.toml && npx wrangler versions upload --config worker/wrangler.toml
```

- Path: `/`
- API token: `Create new token`

Cloudflare build variables:

- `CF_D1_DATABASE_ID`: your D1 Database UUID (from D1 dashboard)

After first deploy, add Worker encrypted secrets:

- `SYNC_ADMIN_TOKEN`
- `DEVICE_SALT`
- `IP_SALT`

## Tests

Worker logic tests:

```bash
npm run test:worker
```

Parser tests:

```bash
pytest
```

## GitHub Actions Secrets

Set these repository secrets:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_D1_DATABASE_ID`
- `CF_WORKER_URL`
- `SYNC_ADMIN_TOKEN`

## Schedules

- Daily sync: `20:30 UTC` (05:30 KST)
- Manual sync: `workflow_dispatch` with optional `target_date`
