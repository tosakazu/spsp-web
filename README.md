# spsp-web — frontend of the SPSP ranking site

The HTML / JS / CSS of [spsp.games](https://spsp.games), plus the Cloudflare Worker that serves it and runs the small API
(login, player cards, votes). The Japan site is at `/jp/`, the North America site at `/na/`.

The rankings themselves (data collection, rating calculation) are built elsewhere and published as JSON on
`https://data.spsp.games/<region>/`. This repository only reads that JSON.
Tournament data and per-region rules (tournament labels, series names, geography) live in
[smash_database](https://github.com/tosakazu/smash_database).
How the pieces fit together: [docs/architecture.md](docs/architecture.md).

## Layout

```
site/                 HTML / CSS / shared modules (js/) / dictionaries / regions. `npm run build` turns it into a deployable dir
  regions/<REGION>/   everything that differs by region: config.js, wording overrides (i18n.js), region-only CSS
  i18n/<lang>.js      UI text dictionaries (en.js, ja.js)
  js/                 shared modules (list and load order: site/js/README.md)
  css/                shared CSS
  seeding/, bracket/  seeding tool and bracket preview
src/pages/<id>.js     per-page code (imports define the load order; the build bundles it into assets/<id>.js)
worker/               Cloudflare Worker: static serving + /api (worker/README.md)
types/                global types (window.SPSP …)
tests/                node --test (meta / post / seeding), jsdom snapshot checks (frontend/), sim, split, views
tools/                build script and helpers
docs/                 architecture.md (start here), seeding tool notes; docs/archive/ = older notes in Japanese
gas/                  the old Google Apps Script backend (kept for reference; the Worker replaced it)
```

## Regions and translation

The site is one shared code base. Anything that differs by region lives in `site/regions/<REGION>/`
(see `site/regions/README.md`); every region directory has the same set of files, and a test fails if one is missing.

- UI text: `site/i18n/en.js` and `site/i18n/ja.js`. The keys are shared by both regions.
- North America wording: `site/regions/NA/i18n.js` overrides keys only where NA needs different wording
  (for example "North America" instead of "Japan"). Only keys that exist in the language dictionary can be overridden.
- Region settings (default language, time zone, enabled features, geography unit …): `site/regions/<REGION>/config.js`.
- The language is chosen with `?lang=en` / `?lang=ja`; each region has one default language (NA: English, JP: Japanese).

Rules for shared code: don't hard-code region names, prefectures/states or time zones (read them from `SPSP.site`
or `data/geo.json`), and put every UI string in the dictionaries.

## Build and run locally

Requires Node.js 22 or newer.

```
npm ci
npm run build:na -- --data-root https://data.spsp.games/na/   # NA site → dist-na/ (reads the live data)
npm run build -- --data-root https://data.spsp.games/jp/      # Japan site → dist/
python3 -m http.server -d dist-na 8080                        # any static server works; open http://localhost:8080/
```

`tools/build/build_site.mjs` copies the static files, bundles each page's script with esbuild into `assets/<id>.js`,
and fills `data-i18n` text from the dictionary of the region's default language.
Login, player-card saving and other `/api` features need the Worker and don't work on a plain static server.

## Tests

```
npm test             # static checks, DOM (jsdom), seeding tool, posts, build (same as CI)
npm run typecheck    # tsc (files with // @ts-check and .ts)
npm run worker:test  # Worker API tests
npm run test:all     # everything above plus sim / split / views
```

Please run `npm test` (and `npm run typecheck` if you touched JS) before opening a pull request.

## Contributing

- Changes go to `main` through pull requests. `main` is protected and needs the owner's approval.
- Merging to `main` deploys to spsp.games automatically (GitHub Actions → Cloudflare).
  The deploy keys live only in the `production` environment and can't be used from other branches or pull requests.
- Never commit keys, tokens or personal information (secret scanning and push protection are on).
- Site news (the bell in the header) is `site/news.json`.

## License

[SPSP Noncommercial License 1.0](LICENSE.md). Non-commercial use is free. Commercial use and hosting the site for others
(publishing it as a website or service) need permission from tosakazu. See [CONTRIBUTING.md](CONTRIBUTING.md) for how
contributions are licensed.
