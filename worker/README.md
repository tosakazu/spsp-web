# spsp-web Worker

The Cloudflare Worker behind **spsp.games**. It serves the static site built from `site/`
(under `/jp/` and `/na/`) and the JSON API under `/api`, with Cloudflare D1 as storage.
Large generated JSON (player pages, tournaments, history) is **not** served here; it lives
in R2 at `data.spsp.games`. The API began as a port of the old Google Apps Script backend
(`gas/`); background is in [docs/archive/refactor/07_cloudflare_plan.md](../docs/archive/refactor/07_cloudflare_plan.md).

## Layout

```
worker/
  wrangler.toml        Worker, assets, D1 binding, vars, environments (preview, na)
  src/index.ts         fetch handler: routing, redirects, assets, security headers
  src/config.ts        Env (bindings / vars / secrets) -> Config
  src/store.ts, db.ts  storage interface and its D1 implementation
  src/api/router.ts    /api entry point and action dispatch
  src/api/*.ts         one module per feature (see below)
  migrations/*.sql     D1 schema
  scripts/             assemble_dist.sh (finishes dist-cf/), import_votes.mjs (one-off import)
  assets/              _headers, 404.html, robots.txt copied into dist-cf/
  test/*.test.mjs      node:test suites (no Cloudflare runtime needed)
```

## Routing (`src/index.ts`)

1. `/api`, `/api/*` -> the API.
2. `/callback.html` (the region-neutral OAuth redirect URI) -> 302 to `/<region>/callback.html`,
   choosing the region from the return path inside the signed `state`.
3. `/` -> 301 to `SITE_PREFIX` (`/jp/` in production).
4. Legacy URLs -> 301: `/spsp/...` (old GitHub Pages paths) and pre-region paths such as `/p/`, `/t/`,
   `/blog/`, `/index.html` get `/jp` prepended; old per-language trees (`/jp/en/...`, `/na/ja/...`)
   become the same page with `?lang=en|ja`.
5. Everything else -> static assets (`dist-cf/`). Missing files get the Worker's 404 page (`/_errors/404`).

Assets matching a file normally bypass the Worker (`run_worker_first` only lists `/api/*` and the
callback pages), so their security headers come from `assets/_headers`. Responses that do go through
the Worker get the same headers in code, and the callback page additionally gets a strict CSP
(`connect-src 'self'`), `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## API

Every response is **HTTP 200 JSON**: `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`
(the build's fetchers treat non-2xx as exceptions). Clients POST a JSON string with
`Content-Type: text/plain` to `/api` as `{ action, ... }`; `POST /api/<action>` also works when the body
has no `action`. CORS is `*`; auth travels in the body (no cookies). Body limit is 64 KB (2 MB for
`title_sync`). A few read-only GET shortcuts exist, noted below; any other GET returns `bad_request`.

| Area | Actions | Notes |
|---|---|---|
| Login (start.gg OAuth) | `begin_login`, `login`, `me` | Signed `state` (single use, recorded in D1); `login` exchanges the code and issues a stateless HMAC session token. `me` checks a token. (`session.ts`, `oauth.ts`, `login.ts`) |
| Player card | `card_get` (`GET /api/card?uid=`), `card_put` | Anyone can read; only the token's own uid can write. Rate limited. (`card.ts`) |
| Titles | `title_get` (`GET /api/titles?uid=&lang=`), `title_sync`, `title_export` | Owned titles per player; D1 is the source of truth. Sync/export are key-protected and used by the build. Title ids are validated against `site/js/titles.js`. (`title_owned.ts`, `titles.ts`) |
| Character votes | `vote` | Eligibility is checked against public player data from `DATA_ORIGIN`. (`vote.ts`) |
| Class brackets (Challonge) | `challonge_begin`, `challonge_token`, `challonge_me`, `class_create`, `class_mine`, `class_delete`, `class_waitlist` (`GET /api/class_waitlist`), `class_done` | TOs create lower-class brackets on their own Challonge account. start.gg and Challonge tokens are used per request and never stored. `class_done` is key-protected and called by the data importer. See [docs/class_bracket_design.md](../docs/class_bracket_design.md). |
| Posts | `post` | Ported but not public yet. (`post.ts`) |
| Logging / export | `client_error`, `export_votes` (`GET /api/export/votes`), `export_errors` (`GET /api/export/errors`) | Failures are logged to D1 with codes only (no tokens or secrets). Exports are key-protected and read by the build. |
| CSP reports | `POST /api/csp-report` (sent by browsers), `csp_export` | Violations of the site CSP are counted per (directive, blocked origin or inline/eval, path); query strings are not stored. Capped at 500 keys and 60 reports per IP per minute. `csp_export` uses the export key. (`csp.ts`) |

## Storage (D1, `migrations/`)

| Table | Purpose |
|---|---|
| `votes`, `posts` | character votes and posts (0001) |
| `errors` | failure log, trimmed automatically (0001) |
| `used_states` | single-use OAuth `state` values (0001) |
| `card_settings`, `card_writes` | player card settings and their rate-limit log (0002) |
| `class_brackets`, `class_actions` | registered lower-class brackets (soft delete via `deleted_at`) and rate-limit log (0003, 0004) |
| `title_owned` | owned title bits and draw counts per player (0005, 0007, 0008) |
| `csp_reports` | aggregated CSP violation reports (0006) |

Session tokens are stateless, so there is no session table.

**Migrations are not applied by the deploy workflow.** A change that needs a new migration must be
applied to the remote database by a maintainer before (or together with) the deploy.

## Configuration

- **Vars** (public, in `wrangler.toml`, per environment): `STARTGG_CLIENT_ID`, `REDIRECT_URI`,
  `CHALLONGE_REDIRECT_URI`, `CSP_MODE` (`report-only` / `enforce`, the site CSP; the string is `SITE_CSP` in `src/index.ts`, and `scripts/assemble_dist.sh` writes it into `_headers` for static assets), `DATA_ORIGIN` (URL, or `assets:/<prefix>` to read from the Worker's own
  assets), `SITE_PREFIX`, `TS_OFFSET`, `SESSION_TTL_MS`, `STATE_TTL_MS`, `VOTE_TESTER_UIDS`.
- **Secrets** (set with `wrangler secret put`, never committed): `STARTGG_CLIENT_SECRET`,
  `SESSION_SECRET`, `EXPORT_KEY` (optional), `CHALLONGE_CLIENT_ID`, `CHALLONGE_CLIENT_SECRET`,
  `TITLE_SYNC_KEY`, `CLASS_DONE_KEY`. A missing secret makes only the dependent actions return `internal`.
- **Environments**: default = production (`spsp-web`, custom domain `spsp.games`);
  `preview` = `spsp-web-preview` on workers.dev with its own D1 and start.gg app;
  `na` = a separate North America Worker (not in use; production serves `/na/` from the main Worker).

## Testing

From the repository root:

```sh
npm ci
npm run worker:test                               # node:test suites in worker/test/
(cd worker && npm run typecheck)                  # tsc --noEmit for the Worker
```

Tests import the `.ts` sources directly via Node's type stripping (Node 22.18+), so only erasable
TypeScript syntax is allowed. They use an in-memory or SQLite store and stubbed `fetch`, so no
Cloudflare account is needed.

## Running locally

`wrangler dev` works with the existing config (local D1, no account required):

```sh
npm run build:cf && sh worker/scripts/assemble_dist.sh --no-build   # build dist-cf/
cd worker
npx wrangler d1 migrations apply spsp --local
npx wrangler dev                                  # or: npm run dev
```

Put any secrets you need for local testing in `worker/.dev.vars` (never commit it). OAuth login
will not complete locally because the redirect URIs point at the deployed hosts.

## Deploying

Contributors do not deploy. A push to `main` runs `.github/workflows/deploy.yml` in the `production`
GitHub environment (restricted to `main`): `npm test`, `npm run typecheck`, `npm run build:cf`,
`assemble_dist.sh`, then `wrangler deploy`. Maintainers can also run it manually with
`workflow_dispatch` to target `preview`. Docs-only changes (`docs/**`, `*.md`) do not trigger a deploy.
The assets limit is 20,000 files per deploy, which is why generated JSON stays in R2.
