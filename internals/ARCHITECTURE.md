# Architecture

## Overview

reeweb has two independently runnable scripts - a dev server and a static site generator - that share the same template engine and i18n library.

| Script | Entry point | Output |
| --- | --- | --- |
| Dev server | `scripts/dev.ts` | HTTP server, no files written |
| Static SSG | `scripts/ssg.ts` | `dist/` with static HTML + assets |

---

## SSG pipeline (`scripts/ssg/`)

`scripts/ssg.ts` is a thin entrypoint; the work lives in `scripts/ssg/` modules:

- `pipeline.ts` - orchestrator
- `cli.ts` - argument parsing
- `translation_merge.ts` - translation tree navigation + merge
- `markdown.ts` - markdown file locale resolution + title extraction
- `routing.ts` - URL/path resolution
- `seo.ts` - hreflang, sitemap, robots
- `page_data.ts` - shared render-data object
- `collections.ts` - frontmatter schema validation
- `sidebar.ts` - sidebar navigation
- `render_templates.ts` / `render_markdown.ts` / `render_pagination.ts` - render phases
- `write_page.ts` - shared output helper (page-local JS bundling + HTML write)
- `group_js.ts` - page-local JS bundling
- `print_page.ts` - render a single page to stdout (`ssg:print-url`)
- `types.ts` - shared types

Walks `src/public/`, renders `.ree`/`.md` per locale, copies static assets to `dist/`.

---

## Dev server (`scripts/dev/`)

`bun dev` runs `scripts/dev/orchestrate.ts`: it performs the one-shot setup steps
(dynamic asset sync, image preparation, initial CSS build), then spawns the Tailwind
CSS watcher (`--watch=always`) and the dev server child process (`scripts/dev.ts`)
side by side. The dev server itself is a thin orchestrator; the work lives in
`scripts/dev/` modules:

- `orchestrate.ts` - `bun dev` entrypoint; setup steps + process supervision
- `cli.ts` - argument parsing
- `site_state.ts` - reloadable translations + route maps
- `resolve.ts` - request URL → locale + file
- `render.ts` - `.ree` / `.md` render handlers
- `pagination.ts` - paginated-route matching
- `page_data.ts` - shared render-data object
- `sidebar.ts` - generic sidebar navigation
- `static_files.ts` - static assets + `dist/` SSG artifacts
- `live_reload.ts` - WebSocket live-reload hub + client script
- `class_ws.ts` / `i18n_ws.ts` - inspector WebSocket messages (class editing, in-place translation editing)
- `class_write.ts` - dev-only class-attribute patcher (rewrites literal `class="..."` in `.ree` source)
- `i18n_write.ts` - translation file writes (MCP tools)
- `watcher.ts` - source file watcher
- `context.ts` - typed DevContext interface
- `responses.ts` - HTTP response helpers
- `mime.ts` - MIME type detection
- `template_data.ts` - template data loading utilities
- `port_release.ts` - frees a held port before restart
- `open_in_editor.ts` - dev inspector "open in editor" support

---

## Shared utilities (`scripts/shared/`)

Both SSG and dev scripts import common utilities from this directory:

- `markdown.ts` - markdown file utilities
- `page_data.ts` - render context data construction
- `pagination.ts` - pagination logic
- `routing.ts` - URL/file path resolution
- `sidebar.ts` - sidebar navigation generation
- `clear_directory.ts` - recreate a directory empty (used to reset `dist/` before a build)
- `demo_content.ts` - removes the template's demo content (used by `bun run remove:demo`)

---

## Template engine

`.ree` files in `src/public/`, compiled by `lib/template_engine.ts` (orchestrator) + `lib/template/` modules:

- `compiler.ts` - tag compiler
- `custom_elements.ts` - hyphenated tag → component include
- `include_handler.ts` / `include_resolver.ts` - `{#include()}` resolution
- `types.ts` - shared types

This is the same engine that ships with Reepolee. See [user-manual/REE_TEMPLATES.md](../user-manual/REE_TEMPLATES.md) (which links to the published docs and the Reepolee engine internals) for the full reference.

---

## Components

Reusable `.ree` snippets in `src/components/`, invoked as custom HTML elements:

```ree
<my-h1 class="heading">title</my-h1>
```

Attributes arrive under `props.attributes`; slot content under `props.children`. 

---

## Layouts

`layout.ree` wraps page content via `{#layout("layout")}`. Per-section layouts via frontmatter (`layout: academic` → resolves `academic.layout.ree`).

---

## Upstream library convention

`lib/` mirrors the upstream reeweb library. **Do not modify it directly** - changes there make it harder to pull upstream fixes.

Put project-specific helpers in:

```
src/lib/project_helpers.ts    # helpers exposed to templates
src/lib/project_hooks.ts      # typed hook implementations
src/lib/markdown_styles.ts    # Tailwind classes for rendered markdown (safe to edit)
```

The upstream `lib/` never imports project code. The hook contract is in `lib/hooks.ts`.

---

## File structure

```
config/
    supported_locales.ts      # Locale list (BCP 47), display names, default locale, aliases
    pagination.ts             # Pagination on/off, registered routes, behaviour toggles
    redirects.ts              # URL redirect rules
lib/                          # Upstream library - do NOT modify directly
    collect_records.ts        # Generic markdown record collector (shared by RSS + pagination)
    pagination.ts             # Pure paginator: chunk + PaginationData view-model
    i18n.ts                   # Translation file loader (walk + merge + fallback)
    markdown_docs.ts          # Markdown HTML post-processor pipeline (TOC, syntax highlight, link rel)
    redirects.ts              # Redirect loader, collision checks, emit helpers
    redirects.test.ts
    route_aliases.ts          # slugify() - URL-safe transliteration
    static_site.ts            # Shared helpers: walk_dir, frontmatter, route map, page collection
    template_engine.ts        # .ree engine orchestrator (load, render, cache)
    template/                 # Engine modules: compiler, custom_elements, include_handler, include_resolver, types
    template_engine.test.ts
    template_helpers.ts       # Template helper functions (date formatting, navigation, display)
    content_visibility.ts     # Published/draft/future-date visibility logic
    hooks.ts                  # Project hook contract (typed, optional)
scripts/
    dev.ts                    # Dev server - thin entrypoint
    dev/                      # Dev-server modules (see above)
    ssg.ts                    # Static site generator - thin entrypoint
    ssg/                      # SSG modules (see above)
    shared/                   # Shared utilities used by SSG and dev (see above)
    preview.ts                # Preview server for dist/
    prepare_images.ts         # Image optimization (runs during bun dev)
    generate_sitemap.ts
    generate_rss.ts
    engine_drift_check.ts     # Verify template engine consistency
    vendor_check.ts           # Verify vendor assets are up-to-date
src/
    public/                   # Source directory for the static site
        index.ree             # Homepage template
        index.ts              # Data loader for homepage
        layout.ree            # Default layout wrapper
        academic.layout.ree   # Academic paper layout
        plain.layout.ree      # Minimal layout without header/footer
        en-us.json / sl-si.json  # Root-level translations (BCP 47 locale filenames)
        about/                # About page (locale-variant templates: index.en-us.ree, index.sl-si.ree)
        blog/                 # Blog section (markdown files)
        contact/              # Contact page
        docs/                 # Documentation section (markdown files)
        css/                  # Tailwind output (style.min.css) + hand-written style.css
        images/               # Static images
        js/                   # Client-side JS (browser-data.js, site-search.js)
    components/               # Reusable .ree components
        my-h1.ree
        speculation-rules.ree
        site-search.ree
        responsive-image.ree
        md-text.ree
        full-pagination.ree
        simple-pagination.ree
    css/                      # Tailwind CSS source
        style.css
        academic.css
        transitions.css
    lib/
        project_helpers.ts    # Project-specific helpers (safe to edit)
        project_hooks.ts      # Hook implementations (safe to edit)
        markdown_styles.ts    # Tailwind class strings for rendered markdown (safe to edit)
        reepolee_api.ts       # fetch_collection() / fetch_record() client for a running reepolee instance
        dynamic_assets.ts     # handle_dynamic_assets() - rewrites *_image/*_file fields to synced local URLs
        locale.ts             # locale_language() - BCP 47 locale -> short language subtag
```

---

## Config files

| File | Purpose |
| --- | --- |
| `reefmt.jsonc` | reettier config: formats `.ree`/`.ts`/`.js`/`.css`, tabs, 150 wrap width |
| `tsconfig.json` | Path aliases (`$config/*`, `$lib/*`, `$root/*`, `$vendor/*`) |
| `config/supported_locales.ts` | Active locale list (BCP 47), display names, default locale, aliases |
| `config/pagination.ts` | Pagination: global on/off, registered routes, behaviour |
| `config/redirects.ts` | URL redirect rules for static sites |
