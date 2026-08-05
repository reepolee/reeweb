---
title: "Languages & Locales"
---

# Languages & Locales

<a name="introduction"></a>

## Introduction

reeweb is a static site generator: every page is rendered once per configured
locale at build time (or on request in the dev server), producing a fully
static HTML tree with no client-side translation step and no JSON shipped to
the browser. Locale is the single localization axis - a full lowercase BCP 47
language-region code such as `en-us` or `sl-si` - used for routing, template
variant selection, translation lookup, and date/currency formatting alike.

This page covers the configuration: which locales are supported, how the
default is chosen, and how a locale reaches a template as `props.locale`. The
other two i18n pages cover translation files ([Translations](/docs/translations))
and locale-localized URLs ([Localized Routes](/docs/localized-routes)).

<a name="the-config-file"></a>

## The Config File

Locales are declared in `config/supported_locales.ts`:

```ts
// All locales that have translation files in the project
export const locales = ["en-us", "sl-si"] as const;

// Locales the locale picker offers (subset of `locales`)
export const active_locales = ["sl-si", "en-us"] as const;

// Locales that are built but excluded from sitemap, feeds, hreflang, and the picker
export const soft_launch_locales: string[] = [];

// First served without selection
export const default_locale = "sl-si";

export const locale_names: Record<string, string> = {
	"en-us": "English",
	"sl-si": "Slovenščina",
};

// UI-string serving aliases: requests for the key locale render the value
// locale's translations (e.g. { "de-at": "de-de" }). One level only.
export const locale_aliases: Record<string, string> = {};
```

Each export has a specific purpose:

- **`locales`** - every locale that has translation files in the project. The translation loader (`lib/i18n.ts`) walks `src/public/` looking for `<locale>.json` files matching this list (e.g. `en-us.json`, `sl-si.json`).
- **`active_locales`** - what the locale picker offers site visitors and what the build renders pages for. Usually equal to `locales`, but can be narrower while a locale is still being translated.
- **`soft_launch_locales`** - locales that are still built (so the URLs exist and are reachable), but are dropped from the sitemap, RSS/JSON feeds, and the hreflang cluster, and are excluded from the picker. Useful for a locale you want live but not yet indexed.
- **`default_locale`** - what gets served at the site root (no locale prefix) and is the fallback template/markdown variant when a locale-specific one is missing.
- **`locale_names`** - display labels for the locale picker.
- **`locale_aliases`** - lets a configured locale (routes, builds, gets its own URLs) share another locale's UI-string translations instead of owning its own translation files. One level only; alias targets must not themselves be aliased.

`src/lib/locale.ts` validates this config at first import and fails loudly - a malformed locale, an unknown alias, an alias chain, or an aliased default all throw immediately at startup rather than surfacing as a confusing runtime gap.

Adding a new locale: extend `locales` (and `active_locales` if it should route/build immediately), add a display name, then create a `<locale>.json` translation file next to every existing one it should overlay. The MCP `add_locale` tool automates this - see [Translations](/docs/translations#the-mcp-tools).

<a name="locale-shape"></a>

## Locale Shape

A locale is always the canonical lowercase BCP 47 form: lowercase language
subtag, lowercase region subtag - `en-us`, `sl-si`, `de-at`. This is the
single identity used everywhere in code, translation filenames, route-map
keys, and URL path segments. BCP 47 tags are case-insensitive, so lowercase
is a fully valid spelling (`Intl` accepts it directly).

Conventional mixed-case casing (`en-US`) is a presentation-only concern:
`format_bcp47()` produces it at output boundaries that expect it (the
`hreflang` attribute, Open Graph's `og:locale`). Incoming values are matched
against the configured list case-insensitively via `canonical_locale()`, so
`/EN-US/` and `/en-us/` both resolve.

```ts
import { locale_language, locale_region, locale_url_segment, canonical_locale, format_bcp47 } from "$root/src/lib/locale";

locale_language("sl-si");    // "sl"    - short language subtag, for <html lang="...">
locale_region("sl-si");      // "si"
locale_url_segment("sl-si"); // "sl-si" - identity: the locale is already the URL/output form
canonical_locale("SL-si");   // "sl-si" - or null if not configured
format_bcp47("sl-si");       // "sl-SI" - conventional casing, for hreflang/og:locale
```

<a name="reading-the-active-locale"></a>

## Reading the Active Locale in Templates

`props.locale` is the active BCP 47 locale for the page being rendered,
injected automatically by the SSG/dev render-data assembly
(`scripts/shared/page_data.ts`). Templates read it directly:

```html
<html lang="{= props.html_lang }">
	...
	<p>{= js_date_to_locale_string(record.created_at) }</p>
	<!-- date/currency helpers default to props.locale -->
</html>
```

Two related fields exist for a reason: `props.locale` is the full lowercase
BCP 47 code (`sl-si`) and is what everything - routing, translation lookup,
Intl formatting - keys off. `props.html_lang` is the short language subtag (`sl`)
computed once via `locale_language(props.locale)`, and exists only because
`<html lang="...">` conventionally takes the short form. Nowhere else in a
template should you need the short form.

The `props.active_locales` and `props.locale_names` fields are also
pre-populated in every render, so a locale picker doesn't need a per-page
`props` entry - it's already there.

<a name="creating-a-locale-picker"></a>

## Creating a Locale Picker

A complete picker that uses the canonical-to-localized URL helper (this is
`src/public/layout.ree`'s actual picker):

```html
<div class="lang-switcher">
	{#each props.active_locales as l}
		<a
			href="{~ localized_path_for_locale(l, props.canonical_path) }"
			class="{= props.locale === l ? 'active' : '' }"
		>{= props.locale_self_names[l]}</a>
	{/each}
</div>
```

- **`localized_path_for_locale(l, props.canonical_path)`** resolves the current canonical page to its localized URL in locale `l` - if you're on `/o-nas` (the Slovenian localization of `/about`) and switch to English, the link goes to `/en-us/about`, not the homepage.
- **`props.locale_self_names`** holds each locale's own name for itself, read from that locale's `ui.language_names` translation key (so the Slovenian entry reads "Slovenščina", not "Slovenian").

The picker is a set of plain links to the already-rendered per-locale pages -
no query param, no redirect, no client JS. Every link is directly shareable.

<a name="locale-aware-formatting"></a>

## Locale-Aware Formatting

The built-in template helpers use `props.locale` for date and number
formatting automatically:

```html
<p>{= js_date_to_locale_string(record.created_at) }</p>
<!-- en-us: "1/15/2026" - sl-si: "15. 1. 2026" -->

<p>{~ display_currency(record.price) }</p>
<!-- en-us: "€1,234.56" - sl-si: "1.234,56 €" -->
```

For one-off formatting in custom helpers, pass `props.locale` (or any BCP 47
string) directly to `Intl`:

```ts
new Intl.NumberFormat(props.locale, { style: "decimal" }).format(value);
```

<a name="locale-variant-templates"></a>

## Locale-Variant Templates and Markdown

Most pages share one `.ree`/`.md` source across every locale and vary only
through translation strings. When a page's *markup* itself needs to differ
per locale - not just its text - drop a locale-suffixed sibling next to the
base file, lowercase locale segment:

```
about/
  index.ree          ← fallback (used if no locale-specific variant exists)
  index.en-us.ree     ← English-specific markup
  index.sl-si.ree     ← Slovenian-specific markup
```

The template engine's fallback chain is `{name}.{locale}.ree` →
`{name}.{default_locale}.ree` → `{name}.ree` (all lowercased), resolved by
`lib/template_engine.ts`'s `load_localized()`. The same chain applies to
markdown files via `resolve_md_file()`. Most pages need none of this - it
exists for the rare case where translated copy genuinely needs a different
layout, not just different words.

<a name="server-startup"></a>

## What Happens at Build/Boot

`config/supported_locales.ts` is read and validated once on import (see
[Locale Shape](#locale-shape)). `lib/i18n.ts` walks `src/public/` and
constructs the translation tree, keyed by locale, at the start of both the
SSG build (`scripts/ssg/pipeline.ts`) and the dev server
(`scripts/dev/site_state.ts`). `lib/static_site.ts`'s
`build_static_route_map()` then builds the canonical → per-locale localized
path lookup used by `localized_path()` and the URL builders. Every active
locale gets its own fully rendered page tree - there is no runtime language
negotiation, no cookie, and no request header involved; the locale a visitor
sees is simply the one whose URL they requested.
