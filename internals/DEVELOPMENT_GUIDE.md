# Development Guide

## Dev modes

| Command | What it does |
| --- | --- |
| `bun dev` | Tailwind watch + dev server via `conc` (fast, no restart on config changes) |
| `bun run development` | Dev server only (no Tailwind watch) |

**Sitemap & feeds in dev:** `/sitemap.xml` and `*/feed.xml` / `*/feed.json` are SSG artifacts. The dev server serves the last-generated copy from `dist/` (stale until next `bun run ssg` / `sitemap` / `rss`). If not generated yet, returns 404 with a hint. `robots.txt` is served from source (`Disallow: /`).

**Preview output:** `bun run preview` serves `./dist`.

**Debug rendering:** `bun scripts/ssg.ts --verbose`.

---

## Static SSG CLI options

```
bun scripts/ssg.ts [--public ./src/public] [--dist ./dist] [--base-url /] [--site-url https://example.com] [--verbose]
```

| Option | Description |
| --- | --- |
| `--public` | Source directory with .ree templates (default: `./src/public`) |
| `--dist` | Output directory for static HTML (default: `./dist`) |
| `--base-url` | Base URL for the site (default: `/`) |
| `--site-url` | Full site URL for hreflang links (default: empty) |
| `--verbose` | Log each rendered file |

---

## Project hooks

`scripts/` is byte-identical across all reeweb projects - never edit it for project-specific behaviour. Instead implement the typed, optional hook contract from `lib/hooks.ts` in:

```
src/lib/project_hooks.ts
```

Every hook is optional; the base project ships `project_hooks = {}` (no-op = upstream defaults):

| Hook | Customizes |
| --- | --- |
| `helper_functions` | Extra functions exposed to every template via `data.helpers` |
| `page_data_extras` | Extra global fields merged into every page's render data |
| `is_localized_path` | SEO policy: mark a path as English-only (drops hreflang) |
| `resolve_md_layout` | Override markdown layout resolution |
| `shape_md_page` | Transform markdown body HTML + add fields (TOC, docs sidebar, coming-soon) |
| `content_visibility` | Per-page visibility override (draft/review/published) |

Pagination is config-driven (`config/pagination.ts`), not a hook.

---

## Content visibility & drafts

Controlled by `lib/content_visibility.ts`. A page is **published** when it is not a draft (`draft: true` / `published: false`) and its `published_at`/`date` is not in the future.

An unpublished page is **SSG-generated but hidden** - rendered and reachable by URL, absent from aggregations, marked `robots: noindex`. The five channels are `render`, `list`, `feed`, `sitemap`, `index`. Override per-page with the `content_visibility` hook.

---

## Reepolee API integration

`src/lib/reepolee_api.ts` provides `fetch_collection()` and `fetch_record()` for fetching live data from a running reepolee instance at SSG or dev time.

**Requirements:**
- reepolee running in agent mode: `bun run agent` (binds to `127.0.0.1:AGENT_SERVER_PORT`)
- `REEPOLEE_API_URL` set in `.env`

```
REEPOLEE_API_URL=http://localhost:2500
```

reepolee routes respond to `Accept: application/json` on existing CRUD endpoints. Routes without JSON support return `{ error: "not found" }` 404. Failures in `load_template_data()` are caught and logged; the page still renders with an empty data set.

Use relative import in data loaders (path alias breaks in dynamic `file://` imports):

```ts
import { fetch_collection } from "../lib/reepolee_api";
```

---

## Testing

```sh
bun test
bun test --watch
```

Co-located test files (`*.test.ts`) live next to the modules they test. The SSG entry (`scripts/ssg.ts`) re-exports `validate_entries()` for testing without side effects (`import.meta.main` guard).
