# ReeWeb - Static Site Generator 🚀

A Bun-based static site generator using custom `.ree` template files with multi-language i18n support.

**Zero runtime dependencies.** Dev dependencies are generation-time tooling only.

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub-easypink?style=flat-square&logo=github)](https://github.com/sponsors/alesvaupotic)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/reepolee/reeweb/blob/main/LICENSE)
[![Status: Beta](https://img.shields.io/badge/status-Beta-b40000?style=flat-square)](https://www.reepolee.com/reeweb/)

ReeWeb is in beta and already powers [reepolee.com](https://www.reepolee.com). APIs, templates, and project structure may still change before 1.0.

---

## Install and generate

```sh
bun reeweb:install
bun dev
# When you are ready to generate the static site:
bun ssg
bun preview
```

---

## Commands

| Purpose                  | Command                                               |
| ------------------------ | ----------------------------------------------------- |
| Project bootstrap        | `bun run reeweb:install`                              |
| Rendering for production | `bun run ssg`                                         |
| CSS watch                | `bun run css:watch` (writes `src/public/css/style.min.css`) |
| CSS build (minified)     | `bun run css:build` (writes committed `src/public/css/style.min.css`) |
| Format                   | `bun run format`                                      |
| Vendor check             | `bun run vendor:check`                                |
| Test                     | `bun test`                                            |
| Test (watch)             | `bun test --watch`                                    |
| Preview                  | `bun run preview` (serves `./dist` via `scripts/preview.ts`) |

### SSG options

```
bun scripts/ssg.ts [options]
```

| Option       | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `--public`   | Source directory with .ree templates (default: `./src/public`) |
| `--dist`     | Output directory for static HTML (default: `./dist`)           |
| `--base-url` | Base URL for the site (default: `/`)                           |
| `--site-url` | Full site URL for hreflang links (default: empty)              |
| `--verbose`  | Log each rendered file                                         |

---

## Template syntax

`.ree` templates use a custom engine with the following tags:

| Tag                               | Behaviour                   | Example                                    |
| --------------------------------- | --------------------------- | ------------------------------------------ |
| `{= expr }`                       | Escaped HTML output         | `{= user.name }`                           |
| `{~ expr }`                       | Unescaped / raw HTML output | `{~ content.html }`                        |
| `{_ path }`                       | Translation lookup, escaped | `{_ ui.title }`                            |
| `{- path }`                       | Translation lookup, unescaped | `{- ui.description }`                    |
| `{@ path }`                       | Translation lookup, markdown | `{@ ui.description }`                     |
| `<tag ...identifier>`             | Attribute spread shorthand  | `<div ...rest>`                            |
| `{{ ... }}`                       | Raw JavaScript              | `{{ const x = items.length; }}`            |
| `{#if cond }...{/if}`             | Conditional                 | `{#if is\_dev }...{/if}`                   |
| `{#each list as item }...{/each}` | Loop (arrays & objects)     | `{#each items as item, i, key }...{/each}` |
| `{#with expr }...{/with}`         | Scope block                 | `{#with author }{= name }{/with}`          |
| `{#layout('path')}`               | Layout wrapper              | `{#layout("layout")}`                      |
| `{#include('path')}`              | Include another template    | `{#include('partials/nav')}`               |
| `<tag-name>...</tag-name>`        | ReeTag component             | `<my-h1 class="heading">...</my-h1>`       |

## ReeTags

ReeTags are reusable `.ree` snippets stored in `src/components/`, invoked with custom HTML element syntax.

### Writing a ReeTag

Create a file `src/components/my-h1.ree`. Attributes arrive under `props.attributes`, slot content under `props.children`:

```ree
{{ const uppercased = props.children.toUpperCase() }}
<h1 class="{= props.attributes.class}">
	{= uppercased }
</h1>
```

### Using a ReeTag in a page

Use custom HTML element syntax. Any tag with a hyphen in its name is checked as a possible ReeTag:

```html
<my-h1 class="bg-amber-300">my title</my-h1>
```

This compiles to a ReeTag include equivalent to:

```ree
{#include('$components/my-h1', { children: "my title", attributes: { class: "bg-amber-300" } })}
```

Which renders as:

```html
<h1 class="bg-amber-300">MY TITLE</h1>
```

To pass a **dynamic** attribute value, interpolate it - `<my-h1 class="{= props.heading_class }">` - and the engine evaluates the expression where the tag sits before handing it to the component under `props.attributes`.

### How it works

1. At compile time, the pre-processor detects `<tag-name>...</tag-name>` patterns (tags with at least one hyphen)
2. It checks whether a matching `src/components/{tag-name}.ree` file exists
3. **If found** - emits an internal marker that the compiler resolves into a ReeTag include, passing slot content as `props.children` and HTML attributes as `props.attributes`
4. **If not found** - the element passes through unchanged, ready for browser-native web components

<details>
<summary>Why an internal marker and not a plain <code>{#include(...)}</code>?</summary>

The props object literal contains braces (e.g. <code>{children: ..., "class": "foo"}</code>). The main regex for <code>{#...}</code> directives uses a non-greedy match that stops at the first <code>}</code>, which would cut the props short before reaching the actual tag closer. So the pre-processor emits a NUL-byte marker that the compiler resolves into an <code>__rtInclude(...)</code> call after the directive scan - the NUL bytes can't appear in source, so the data payload parses safely.

</details>

This means you can seamlessly mix ReeTags and native web components:

```html
<!-- ReeTag (has src/components/my-slider.ree) -->
<my-slider min="0" max="100">Volume</my-slider>

<!-- Native web component (no matching .ree file) -->
<my-datepicker locale="sl-SI"></my-datepicker>
```

### ReeTag props

Any HTML attribute on the ReeTag becomes a prop in the component:

| HTML                                  | Component receives (`props`)                              |
| ------------------------------------- | --------------------------------------------------------- |
| `<my-h1>text</my-h1>`                 | `{ children: "text" }`                                    |
| `<my-h1 class="foo">text</my-h1>`     | `{ children: "text", attributes: { "class": "foo" } }`    |
| `<my-card disabled>text</my-card>`    | `{ children: "text", attributes: { "disabled": true } }`  |
| `<my-card data-id="5">text</my-card>` | `{ children: "text", attributes: { "data-id": "5" } }`    |

---

## Architecture

- **Entry point**: `scripts/ssg.ts` - thin entrypoint over the `scripts/ssg/` modules (`pipeline.ts` orchestrator + focused pieces); walks `./src/public`, renders `.ree`/`.md` to static HTML, copies static assets.
- **Templates**: `.ree` files in `src/public/`, custom engine at `lib/template_engine.ts` (orchestrator) + `lib/template/` modules.
- **ReeTags**: Reusable `.ree` snippets in `src/components/`, referenced as `<component-name>` custom HTML elements (attributes under `props.attributes`, slot under `props.children`).
- **Layouts**: `layout.ree` wraps page content via `{#layout("layout")}`. Per-section layouts supported via frontmatter (`layout: academic`).
- **Data files**: Sibling `.ts` files export `load_template_data()` - called on every request in dev and once per page during SSG to inject dynamic data into templates. Can fetch live data from external APIs (e.g. reepolee via `REEPOLEE_API_URL`).
- **Translations**: `{lang}.json` files next to templates, loaded by `lib/i18n.ts` and merged into render data.
- **Markdown**: `.md` files in `src/public/` are rendered via `Bun.markdown.html()` with frontmatter parsing, syntax highlighting, and Tailwind class injection.
- **CSS**: Tailwind v4 via standalone CLI (`tailwindcss`). Source in `src/css/`, output to `src/public/css/style.min.css`.
- **Path aliases** (tsconfig): `$config/*`, `$lib/*`, `$root/*`, `$vendor/*`.

---

## File structure

```
|-- config/
|   |-- pagination.ts
|   |-- redirects.ts
|   |-- responsive_images.ts
|   |-- supported_languages.override.ts
|   `-- supported_languages.ts
|-- lib/
|   |-- i18n.ts                   # Translation loader
|   |-- markdown_docs.ts          # Markdown HTML post-processor
|   |-- route_aliases.ts          # URL-safe slugify
|   |-- static_site.ts            # Walk_dir, frontmatter, route map
|   |-- template_engine.ts        # .ree engine orchestrator
|   |-- template/                 # Engine modules (compiler, custom_elements, includes, types)
|   `-- template_helpers.ts       # Date formatting, navigation, display
|-- src/
|   |-- components/               # Reusable ReeTag .ree components
|   |   |-- banner.ree
|   |   |-- full-pagination.ree
|   |   |-- md-text.ree
|   |   |-- my-h1.ree
|   |   |-- responsive-image.ree
|   |   |-- simple-pagination.ree
|   |   `-- speculation-rules.ree
|   |-- public/                   # Source directory for the static site
|   |   |-- index.ree             # Homepage
|   |   |-- index.ts              # Data loader
|   |   |-- layout.ree            # Default layout
|   |   |-- academic.layout.ree   # Academic paper layout
|   |   |-- plain.layout.ree      # Minimal no-header/footer layout
|   |   |-- en.json / sl.json     # Root-level translations
|   |   |-- about/                # About page (multi-language)
|   |   |-- blog/                 # Blog (markdown files)
|   |   |-- contact/              # Contact page
|   |   |-- docs/                 # Documentation (markdown files)
|   |   |-- css/style.min.css         # Compiled Tailwind output (committed; built by css:build)
|   |   `-- images/               # Static images
|   `-- css/                      # Tailwind CSS source
|       |-- academic.css
|       `-- style.css
|-- scripts/
|   |-- ssg.ts                    # Static site generator entrypoint (thin over scripts/ssg/)
|   |-- ssg/                      # SSG modules: pipeline, render phases, routing, seo, page_data
|   |-- dev.ts                    # Development server (thin entrypoint over scripts/dev/)
|   |-- dev/                      # Dev-server modules: site_state, resolve, render, pagination
|   |-- preview.ts                # Preview server
|   |-- generate_rss.ts           # RSS feed generator
|   `-- generate_sitemap.ts       # Sitemap generator
|-- vendor/
|   |-- highlight.min.js          # Syntax highlighting
|   `-- zod.min.js                # Content collection validation
|-- package.json
|-- tsconfig.json
`-- .env.example
```

---

## Language support

| File                            | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `config/supported_languages.ts` | Active language list, locale mappings, default language |
| `lib/i18n.ts`                   | Translation loader with cross-language fallback         |

Languages are configured in `config/supported_languages.ts`. Each language gets a `{lang}.json` file per directory. The default language is served at root; others under `/{lang}/`.

### Reading translations in templates

Use the `{_ path }` (escaped), `{- path }` (unescaped) and `{@ path }` (markdown) lookup tags to read translation strings from `props.translations`:

```ree
<h1>{_ ui.welcome_title }</h1>
<p>{- ui.description }</p>
<a href="/about">{_ nav.home }</a>
<article>{@ ui.body_markdown }</article>
```

The `path` is a simple dotted property path resolved against `props.translations`. `{@ }` renders the resolved value through markdown (via `Bun.markdown.html`) to HTML - use it for a translation value authored as markdown source (headings, lists, `**bold**`, links). If a key is missing, the tag renders `{last_segment}` instead of throwing or rendering empty - useful while scaffolding a page before its translation keys are wired up.

For the full reference, including the escape hatch for lookups that can't be written as a simple dotted path, see the [translations docs](https://www.reepolee.com/docs/reeweb/i18n/translations/).

Translation files can include a `route_name` key to localize URL paths:

```json
{ "about": { "route_name": "o nas" } }
```

This generates `/o-nas/` for Slovenian and `/about/` for English.

### Language-variant templates

Templates can have language-specific variants:

- `index.sl.ree` + `index.en.ree` resolves per-language
- Fallback chain: `{name}.{lang}.ree` -> `{name}.{default_lang}.ree` -> `{name}.ree`

---

## Data loading

Templates can have sibling `.ts` files exporting `load_template_data()`:

```typescript
export async function load_template_data(): Promise<Record<string, any>> {
	return { posts: await fetchPosts() };
}
```

Called on every request in `bun run dev` and once per page during `bun run ssg`. Data is merged into the render context. Failures are logged and return `{}` so a broken data file doesn't take down the page.

### Fetching from reepolee

`src/lib/reepolee_api.ts` provides `fetch_collection()` and `fetch_record()` for fetching data from a running reepolee instance. Requires reepolee running in agent mode and `REEPOLEE_API_URL` set in `.env`:

```
# .env
REEPOLEE_API_URL=http://localhost:2500   # reepolee AGENT_SERVER_PORT
```

Start reepolee: `bun run agent` (dev-only; binds to `127.0.0.1:AGENT_SERVER_PORT`). Routes respond to `Accept: application/json` with a `{ data, total, limit, offset }` envelope. Routes without JSON support return `{ error: "not found" }` 404.

---

## Markdown

`.md` files in `src/public/` support:

- Frontmatter (YAML between `---` delimiters)
- Layout selection via `layout: name` field
- Sidebar navigation via `has_sidebar: true`
- Syntax highlighting (via highlight.js, server-side)
- Auto-generated heading IDs, Tailwind classes injected

---

## Content collections

Validate markdown frontmatter during SSG, Astro-in-spirit but in TypeScript
(no YAML schemas). Drop a `_schema.ts` exporting a Zod `schema` into any folder
under `src/public/` - its presence auto-registers that folder as a collection:

```ts
// src/public/blog/_schema.ts
import { z } from "$vendor/zod.min.js";

export const schema = z.object({
	title:        z.string().min(1),  // required
	published_at: z.coerce.date(),    // required
}).passthrough();
```

`bun run ssg` validates every entry (each `.md`, including language variants;
the route's listing index is skipped) **before** rendering and **fails loudly**
on any violation - a missing required field or a wrong type prints an aggregated
report and exits non-zero, so a broken site never ships. Relax a field with
`.optional()`; drop `.optional()` to make a field mandatory.

Zod is **vendored** (`vendor/zod.min.js`), not an npm dependency - validation is
SSG-only, so the published site keeps zero runtime dependencies. Re-fetch
with `bun run get:zod`.

---

## Pagination

Reeweb ships a default, statically-generated pagination feature. Configure it in
[`config/pagination.ts`](config/pagination.ts):

```ts
export const pagination: PaginationConfig = {
	enabled: true,            // global on/off
	per_page: 10,
	path_segment: "",         // "" -> /blog/2/ ; "page" -> /blog/page/2/
	show_when_single_page: false,  // hide when everything fits on page 1 (Laravel hasPages())
	always_show_prev_next: true,   // render Prev/Next always, disabled at the ends
	variant: "full",
	routes: [{ route: "blog" }],   // register one or more routes
};
```

For each registered `route`, the SSG collects its records, chunks them by
`per_page`, and renders the route's `index.ree` once per page:

```
/blog/        (page 1)   ->  dist/blog/index.html
/blog/2/      (page 2)   ->  dist/blog/2/index.html
/en/blog/2/   (per-lang) ->  dist/en/blog/2/index.html
```

`path_segment` defaults to `""`, so page URLs are `/blog/2/` - language-neutral, with
no untranslated "page" word to localize. Set `path_segment: "page"` for Laravel-style
`/blog/page/2/`. With the empty default, avoid purely-numeric record slugs in a
paginated route (a post named `2` would collide with page 2).

The `index.ree` receives `props.records` (the current page's slice) and
`props.pagination` (a `PaginationData` view-model):

```ree
{#each props.records as post}
  <h2><a href="{~ localized_path(post.canonical_path) }">{= post.title }</a></h2>
{/each}

<full-pagination data="{= props.pagination }" on-each-side="2"></full-pagination>
```

### Components

Two shipped components consume `props.pagination`:

| Component                     | Renders                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `<full-pagination>`           | Numbered links + Prev/Next + "Showing X to Y of Z"       |
| `<simple-pagination>`         | Previous / Next only                                     |

- The optional `on-each-side="N"` attribute on `<full-pagination>` windows the page
  numbers to plus or minus N around the current page with ellipses (omit it to show **all** pages).
- Either component accepts an optional `per-page="N"` attribute that overrides the
  config `per_page` for that route. Because page count is decided during SSG, this
  must be a **literal integer** - it's read from the template source, not at render
  time. Precedence: `per-page` attribute -> route `per_page` -> global `per_page`.
- Component names **must contain a hyphen** (custom-element requirement). The data
  object is passed via the `data="{= props.pagination }"` attribute expression - the
  only way to hand a component a live object, since `{#include(...)}` can't carry a
  brace object literal.

### Records from an external source (API / DB)

A route is not limited to markdown. Set `source: "loader"` and export
`load_records(lang)` from the route's `index.ts` to paginate records from anywhere:

```ts
// src/public/products/index.ts
export async function load_records(lang: string): Promise<any[]> {
	const res = await fetch("https://api.example.com/products");
	return res.json();
}
```

Records are fetched **once per route per language during SSG** and baked into
static `/page/N/` HTML. The default markdown collector lives in
[`lib/collect_records.ts`](lib/collect_records.ts) - to customize collection, copy it
into `src/lib/` rather than editing `lib/`.

`bun dev` renders paginated routes live too (the dev server shares the same
record-resolution and paginator code), so `/blog/` and `/blog/2/` work without
an SSG step.

---

## Dev mode

Run the development server:

```sh
bun run dev
```

This starts a local server with file watching. Changes to templates, translation files, and markdown trigger auto-reload in the browser.

Run `bun run css:watch` in a separate terminal for live Tailwind recompilation.

Preview the built output with `bun run preview`.

See the [.ree template docs](https://www.reepolee.com/docs/reeweb/ree-templates/introduction/) for the full template engine reference.

## On-pull scripts

`reedash`, the git operations dashboard, can manage project-root `onpull.sh`
and `onpull.ps1` files for this repo. After `reedash` successfully fast-forward
pulls the project, it runs the current platform's script in the background:
`onpull.sh` on macOS/Linux, `onpull.ps1` on Windows.


## 💖 Support & Sponsor ReeWeb

ReeWeb is built to keep web development fast, simple, and free of `node_modules` bloat. It is 100% free and open source. 

If ReeWeb saves you time, powers your projects, or helps you ship clean static sites faster, consider supporting its ongoing maintenance and development!

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub-easypink?style=for-the-badge&logo=github)](https://github.com/sponsors/alesvaupotic)

### How your support helps:
- 🛠️ Maintenance & Bun compatibility updates
- 🚀 New features (plugin architecture, recipes)
- 📚 Continuous documentation improvements

---

[reepolee.com](https://www.reepolee.com)
