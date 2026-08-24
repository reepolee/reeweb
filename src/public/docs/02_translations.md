---
title: "Translations"
---

# Translations

<a name="introduction"></a>

## Introduction

reeweb's translation system reads JSON files from `src/public/` and merges
them into a single nested object per locale at build/boot time. There is no
translation library, no extraction pipeline, and no compilation step - you
write JSON, `lib/i18n.ts` reads it, and templates access the strings via
`props.<key>` (merged into every page's render data) or the `{_ }` / `{- }`
lookup tags.

Translation files live alongside the page they translate. The about page's
strings are in `src/public/about/en-us.json` (and `sl-si.json`, and any other
configured locale). Global strings - navigation labels, the footer, common UI
text - live at `src/public/en-us.json`. When a page under `about/` renders,
it gets both layers merged automatically.

<a name="file-layout"></a>

## File Layout

The convention is one `<locale>.json` file (BCP 47, e.g. `en-us.json`) per
folder that needs its own strings, plus one at the root of `src/public/` for
global strings:

```
src/public/
├── en-us.json                       ← global English strings
├── sl-si.json                       ← global Slovenian strings
├── about/
│   ├── en-us.json                   ← about-page English
│   └── sl-si.json
├── contact/
│   ├── en-us.json
│   └── sl-si.json
└── blog/
    ├── translations/                ← alternative: a "translations" subfolder
    │   ├── en-us.json
    │   └── sl-si.json
    └── ...
```

Either layout works - `lib/i18n.ts` walks the directory tree recursively
looking for `.json` files whose name (minus extension) matches one of the
configured `locales`. The `translations/` subfolder convention keeps a
folder's translations visually separate from its content; a page folder with
few files typically puts the JSON directly alongside the template.

<a name="file-contents"></a>

## What Goes in a Translation File

A typical file groups labels under a small set of keys. Here's (an excerpt
of) the real `src/public/en-us.json` (global strings):

```json
{
	"nav": {
		"about": "About",
		"blog": "Blog",
		"contact": "Contact",
		"home": "Home"
	},
	"route_name": "",
	"search": {
		"placeholder": "Search…",
		"type_to_search": "Type to search…"
	},
	"site_name": "My Static Site",
	"ui": {
		"language_names": { "en-us": "English", "sl-si": "Slovenščina" },
		"welcome_title": "Welcome to My Static Site",
		"...": "..."
	}
}
```

Three things to notice:

- **`route_name`** is a reserved key - its value drives URL localization. The Slovenian translation of the about page has `"route_name": "o-nas"`, which makes the canonical `/about` reachable as `/o-nas` in Slovenian. See [Localized Routes](/docs/localized-routes).
- **`ui.language_names`** is keyed by lowercase locale code and holds each locale's own display name - `en-us.json`'s copy says `"sl-si": "Slovenščina"`, `sl-si.json`'s copy says `"sl-si": "Slovenščina"`. This is what the locale picker's `props.locale_self_names` reads (see [Languages & Locales](/docs/languages-and-locales#creating-a-locale-picker)).
- **Grouping is convention, not enforced.** `nav`, `ui`, `search` keep related strings together and avoid collisions between, say, a nav label and a page heading. Templates read whatever shape you choose - `props.nav.home`, `props.ui.welcome_title`, etc.

<a name="reading-translations-in-templates"></a>

## Reading Translations in Templates

The SSG and dev render-data assembly (`scripts/shared/page_data.ts`) merges a
page's translation tree into its render data automatically - no per-page
wiring required. A page's own translations and the global `routes` bundle are
already spread onto `props`, plus available under `props.translations` for
the `{_ }` / `{- }` lookup tags:

```html
<h1>{_ ui.welcome_title}</h1>
<p>{- ui.rich_html_text}</p>
<a href="{~ localized_path('/about') }">{_ nav.about}</a>
```

- **`{_ key}`** - escaped translation lookup against `props.translations`.
- **`{- key}`** - raw (unescaped) translation lookup, for strings that legitimately contain HTML.
- **`{@ key}`** - markdown translation lookup (renders the string through the markdown pipeline).

Route-specific translations (e.g. `about/en-us.json`) are merged on top of
the global bundle, so a route can override a global key or add its own.

<a name="loading-and-namespaces"></a>

## How Files Are Loaded

`lib/i18n.ts`'s `load_all_translations(root_dir, locales)` walks
`src/public/` at build/boot time. For each JSON file it finds:

1. The locale comes from the filename (`en-us.json` → `en-us`); files whose name isn't in the configured `locales` list are skipped.
2. The namespace comes from the directory path. `about/en-us.json` becomes the namespace `about`; the root `en-us.json` becomes the namespace `routes` (a reserved name that holds the global strings, always merged in first).
3. The file contents are nested under that namespace in the locale's tree.

For files inside a `translations/` subfolder, the `translations` segment is
stripped - `blog/translations/en-us.json` becomes the namespace `blog`, not
`blog.translations`.

The final structure looks like:

```js
{
	"en-us": {
		routes: { nav: { home: "Home", ... }, site_name: "My Static Site", ... },
		about: { route_name: "", highlights: [...] },
	},
	"sl-si": {
		routes: { nav: { home: "Domov", ... }, site_name: "Moja statična stran", ... },
		about: { route_name: "o-nas", highlights: [...] },
	},
}
```

<a name="fallback-merge"></a>

## Fallback Merge

After all files are loaded, `lib/i18n.ts` fills in missing keys across
locales so a partially-translated file doesn't produce empty strings. The
rule: for each locale and each namespace, any key missing or empty in that
locale is filled from any other locale that has it.

The exception is `route_name` - it is *never* inherited across locales. A
missing `route_name` means "use the canonical (English-authored) segment for
this locale's URL," not "borrow another locale's segment." This lets you ship
a page before translating its URL and still get a working route.

In practice:

- **Untranslated strings show up in another locale** rather than as blanks - visible during review, not silently missing.
- **Untranslated URLs stay canonical.** Add a locale incrementally: translate the strings first, leave `route_name` unset, localize the URL segment later.
- **The fallback is implicit, not configured.** There's no preferred-fallback-locale setting; whichever locale has the value provides it.

<a name="the-mcp-tools"></a>

## Maintaining Translations with the MCP Server

`scripts/mcp/` exposes translation maintenance as MCP tools (see
`scripts/mcp/tools_translations.ts`):

- **`check_translations`** (read-only) - cross-locale key gaps per translation folder, template-referenced keys missing from every locale, and authored keys no template references (possible orphans; dynamic keys can be false positives).
- **`set_translations`** - upsert dotted-key entries into the owning `{locale}.json` files, indentation-preserving. Requires `MCP_ENABLE_MUTATIONS=true`.
- **`add_locale`** - registers a new locale in `config/supported_locales.ts` and seeds a `{locale}.json` next to every default-locale file (values copied from the default, `route_name` stripped so slugs stay unlocalized until translated). Optionally alias the new locale to an existing one's translations (`locale_aliases`) instead of seeding files. Requires `MCP_ENABLE_MUTATIONS=true`.
- **`remove_locale`** - deletes a locale's `{locale}.json` files and unregisters it. Refuses the default locale; reports (does not delete) leftover locale-variant templates. Requires `MCP_ENABLE_MUTATIONS=true`.

<a name="adding-new-strings"></a>

## Adding New Strings

The flow for adding a string to an existing page:

1. **Add the key to every configured locale's file.** Adding it to just the default locale's file works too (the fallback fills the rest), but translating it explicitly is better.
2. **Use it in your template.** `{= props.your_new_key }` (escaped) if it's flat on `props`, or `{_ your_new_key}` against `props.translations` for the lookup-tag form.

No static-generation step beyond the next `bun run ssg`, no extraction tool,
no codegen. For a global string available on every page, add it to
`src/public/en-us.json` (and the equivalent file for every locale). For a
string specific to one page, add it to that page's own `<locale>.json`.

<a name="reloading-in-development"></a>

## Reloading Translations in Development

`bun dev` re-reads translations on every source-file change - the dev
server's watcher (`scripts/dev/watcher.ts`) calls `SiteState.reload()`, which
re-runs `load_all_translations()`, whenever a `.ree`, `.md`, or `.json` file
changes. Editing a translation file and refreshing the page picks up the new
value automatically; no manual reload step exists or is needed.
