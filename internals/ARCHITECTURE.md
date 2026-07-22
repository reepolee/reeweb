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
- `markdown.ts` - markdown file language resolution + title extraction
- `routing.ts` - URL/path resolution
- `seo.ts` - hreflang, sitemap, robots
- `page_data.ts` - shared render-data object
- `collections.ts` - frontmatter schema validation
- `sidebar.ts` - sidebar navigation
- `render_templates.ts` / `render_markdown.ts` / `render_pagination.ts` - render phases

Walks `src/public/`, renders `.ree`/`.md` per language, copies static assets to `dist/`.

---

## Dev server (`scripts/dev/`)

`scripts/dev.ts` is a thin orchestrator; the work lives in `scripts/dev/` modules:

- `site_state.ts` - reloadable translations + route maps
- `resolve.ts` - request URL → language + file
- `render.ts` - `.ree` / `.md` render handlers
- `pagination.ts` - paginated-route matching
- `page_data.ts` - shared render-data object
- `sidebar.ts` - generic sidebar navigation
- `static_files.ts` - static assets + `dist/` SSG artifacts
- `live_reload.ts` - WebSocket live-reload hub + client script
- `watcher.ts` - source file watcher
- `context.ts` - typed DevContext interface
- `responses.ts` - HTTP response helpers
- `mime.ts` - MIME type detection
- `template_data.ts` - template data loading utilities

**`bun dev`** runs image preparation, Tailwind CSS watch, and the dev server concurrently via `conc`.

---

## Shared utilities (`scripts/shared/`)

Both SSG and dev scripts import common utilities from this directory:

- `markdown.ts` - markdown file utilities
- `page_data.ts` - render context data construction
- `pagination.ts` - pagination logic
- `routing.ts` - URL/file path resolution
- `sidebar.ts` - sidebar navigation generation

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
    supported_languages.ts    # Language list, locale mappings, default language
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
    reconcile.ts              # Reconcile project state and dependencies
    release.ts                # Thin wrapper delegating packaging to ../reelease
src/
    public/                   # Source directory for the static site
        index.ree             # Homepage template
        index.ts              # Data loader for homepage
        layout.ree            # Default layout wrapper
        academic.layout.ree   # Academic paper layout
        plain.layout.ree      # Minimal layout without header/footer
        en.json / sl.json     # Root-level translations
        about/                # About page (language-variant templates)
        blog/                 # Blog section (markdown files)
        contact/              # Contact page
        docs/                 # Documentation section (markdown files)
        css/style.css         # Page-specific CSS
        images/               # Static images
    components/               # Reusable .ree components
        banner.ree
        my-h1.ree
        speculation-rules.ree
    css/                      # Tailwind CSS source
        style.css
        transitions.css
    lib/
        project_helpers.ts    # Project-specific helpers (safe to edit)
        project_hooks.ts      # Hook implementations (safe to edit)
        markdown_styles.ts    # Tailwind class strings for rendered markdown (safe to edit)
```

---

## Config files

| File | Purpose |
| --- | --- |
| `reettier.jsonc` | reettier: formats `.ree`/`.ts`/`.js`/`.css`, tabs, 120 wrap width |
| `tsconfig.json` | Path aliases (`$config/*`, `$lib/*`, `$root/*`, `$vendor/*`) |
| `config/supported_languages.ts` | Active language list and locale mappings |
| `config/pagination.ts` | Pagination: global on/off, registered routes, behaviour |
| `config/redirects.ts` | URL redirect rules for static sites |
