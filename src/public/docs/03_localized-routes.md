---
title: "Localized Routes"
---

# Localized Routes

<a name="introduction"></a>

## Introduction

reeweb builds one fully static URL per (canonical page × active locale). URLs
are localized the same way strings are - through the JSON translation files
in `src/public/`. A Slovenian translation file with `"route_name": "o-nas"`
makes the canonical `/about` reachable as `/o-nas`, built as its own static
HTML file at build time. There is no runtime routing decision: every locale's
version of every page already exists as a file in `dist/` before a browser
ever asks for it.

Localized URLs are useful for SEO (each locale gets its own indexable URL),
for user comprehension (a Slovenian reader recognizes `/o-nas`), and for
sharing (a Slovenian URL stays Slovenian when forwarded). None of it requires
extra code per page - `scripts/ssg/pipeline.ts` builds the localized route map
from the translation files you already have and renders every locale
automatically.

<a name="how-localization-is-declared"></a>

## How Localization Is Declared

The `route_name` key in a translation file tells the route map how to
localize that segment. `src/public/about/sl-si.json`:

```json
{
	"route_name": "o-nas"
}
```

`lib/static_site.ts`'s `build_static_route_map()` walks the canonical path
`/about` segment by segment and looks up each segment's translation. `about`
becomes `o-nas`, and the localized path for the Slovenian locale is `/o-nas`.

If a segment has no translation file or no `route_name` key, the canonical
segment is used as-is. A partially-localized site is fine - a nested route
can localize its own leaf without every ancestor segment being localized too.

<a name="canonical-vs-localized"></a>

## Canonical vs Localized Paths

Two terms come up throughout the codebase:

- **Canonical path** - the path derived from the file's location under `src/public/` (`lib/static_site.ts`'s `template_to_canonical()`). Always English-authored by convention: `/about`, `/blog/my-post`, `/docs/intro`.
- **Localized path** - the per-locale version: `/o-nas` for `sl-si`, `/about` for `en-us`.

Internally, page templates, data loaders, and the route map work with
canonical paths. URLs written into rendered HTML - links, `<form action>`,
canonical/hreflang tags - use the localized path. The `localized_path()`
template helper is the bridge.

<a name="localized-path-helper"></a>

## The localized_path Helper

`localized_path(canonical)` returns the current page's locale's localized
URL for a canonical path (including the locale's URL prefix):

```html
<a href="{~ localized_path('/about') }">About</a>
<a href="{~ localized_path('/contact') }">Contact</a>
<form method="POST" action="{~ localized_path(props.canonical_path) }">...</form>
```

Note the raw output tag `{~ }` - the localized path is safe by construction
and shouldn't be double-escaped.

`localized_path_for_locale(target_locale, canonical)` is the same lookup for
an *arbitrary* locale rather than the current page's - used by the locale
picker to build links to every other locale's version of the current page
(see [Languages & Locales](/docs/languages-and-locales#creating-a-locale-picker)).

If there's no localized segment available anywhere in the path (no
`route_name` in any segment's translation), both helpers return the canonical
path, prefixed for the target locale.

<a name="url-shape"></a>

## URL Shape

The default locale is served at the site root, with no locale prefix. Every
other active locale is served under its lowercase locale-segment prefix - the
full BCP 47 code in canonical lowercase form:

```
/o-nas/                 ← default locale (sl-si), no prefix
/en-us/about/           ← en-us, full lowercase locale prefix
```

This is deliberate: the URL always carries the *complete* locale identity
(language + region), not a bare two-letter language code, so `en-us` and a
hypothetical future `en-gb` never collide on `/en/`. `scripts/shared/routing.ts`'s
`output_target()` computes the output path and request URL for a page; it is
the single place this prefix logic lives.

<a name="automatic-route-registration"></a>

## Automatic Route Registration

`scripts/ssg/pipeline.ts` builds the full route map and render context once
per build:

```ts
const route_map = build_static_route_map(translations, page_files, locales);
const route_resolver = create_route_resolver(route_map, default_locale);
```

Then every render phase (`render_ree_templates`, `render_markdown_files`,
`render_paginated_routes`) iterates `locales` and renders each page once per
locale through that resolver - `output_target()` computes each locale's
output file and request URL, `build_hreflang_links()` computes its hreflang
cluster. You write one template per page; every configured locale is built
automatically, with no per-locale registration step.

The dev server's `SiteState` (`scripts/dev/site_state.ts`) builds the same
route map at boot and rebuilds it on `reload()`, so dev previews match what a
build would produce.

<a name="locale-variant-page-source"></a>

## When a Page's Source Itself Varies by Locale

Localized *URLs* are independent of localized *markup* - most pages share one
`.ree`/`.md` source and vary only through translation strings layered on top.
When a page's markup genuinely needs to differ per locale, see
[Locale-Variant Templates and Markdown](/docs/languages-and-locales#locale-variant-templates)
in the Languages & Locales page.

<a name="pages-you-dont-want-to-localize"></a>

## Pages You Don't Want to Localize

Routes are about *which URLs* resolve; this is about *content*. Some pages
have the same body in every locale - English-only documentation, an
English-only engineering blog. They still need to be reachable under every
locale prefix (so a Slovenian-locale visitor can open `/sl-si/blog/...`
without the rest of their session changing), but you don't want each prefix
indexed as a separate page. Letting `/blog/post` and `/sl-si/blog/post` both
into the index serves byte-identical content at two URLs, splitting ranking
signals and burning crawl budget.

Mark such a page with `localize: false` in its frontmatter:

```markdown
---
title: "Why we bet on Bun"
localize: false
---
```

The SSG still renders every locale variant, but the SEO signals change so the
default locale is the single canonical page:

- **`rel=canonical`** - each non-default variant (`/sl-si/blog/post`) emits `<link rel="canonical" href="https://…/blog/post/">` pointing at the default-locale URL. This is the primary, correct deduplication signal: it tells Google the pages are the same and to credit the default-locale one.
- **No hreflang cluster** - the page drops out of the `<link rel="alternate" hreflang="…">` set. Advertising a byte-identical page as a different locale is a false signal, and Google discards hreflang clusters whose members canonicalize elsewhere - which would break hreflang for the page you *do* want ranked.
- **Sitemap** - only the default-locale `<loc>` is emitted; the other-locale URLs are left out (see [`generate_sitemap.ts`](https://github.com/reepolee/reeweb/blob/main/scripts/generate_sitemap.ts)).

Reach for `localize: false` rather than `robots.txt` `Disallow` or a bare
sitemap omission. A sitemap omission alone doesn't stop indexing - Google
still finds the URLs through your internal links (the locale switcher). And a
`robots.txt` `Disallow` is worse here: it blocks the crawl, so Google can
never *see* the `rel=canonical` and may index the URL anyway without a
snippet. Let the page be crawled and let the canonical do its job.

`localize: false` is independent of `route_name`: localize the *URL* (so
`/blog` reads naturally in each locale) while keeping the *content*
single-canonical. The two settings compose.
