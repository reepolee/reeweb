---
title: "Localized Routes"
---

# Localized Routes

<a name="introduction"></a>

## Introduction

Reepolee translates URLs the same way it translates strings - through the JSON files in `routes/`. A Slovenian translation file with `"route_name": "prijava"` makes `/login` reachable as `/prijava` in Slovenian, and `/system/users` reachable as `/sistem/uporabniki`. The same handler runs at both URLs; the path is just an alias for the canonical English route.

Localised URLs are useful for SEO (each language gets its own indexable URLs), for user comprehension (a non-English speaker reading a URL bar can recognise the page), and for sharing (a Slovenian URL stays Slovenian when you send it to a friend). All of it works without extra code in your handlers - `server.ts` registers the localised aliases automatically at boot from the translation files you already have.

<a name="how-localisation-is-declared"></a>

## How Localisation Is Declared

The `route_name` key in a translation file tells the route map how to localise that segment. The Slovenian translation of `routes/system/translations/sl.json`:

```json
{
	"route_name": "sistem"
}
```

And `routes/system/users/translations/sl.json`:

```json
{
	"route_name": "uporabniki",
	"actions": { "submit": "Shrani" }
}
```

When the route table is assembled at boot, the canonical path `/system/users` walks each segment and looks up its translation. `system` becomes `sistem`, `users` becomes `uporabniki`, and the full localised path is `/sistem/uporabniki`.

If a segment has no translation file or no `route_name` key, the canonical segment is used as-is. So a partially-localised app is fine - you can translate `system` without translating `users` yet, and the URL becomes `/sistem/users` until you fill in the rest.

<a name="canonical-vs-localised"></a>

## Canonical vs Localised Paths

Throughout the codebase, two terms come up:

- **Canonical path** - the path as it appears in `routes/routes.ts`. Always English by convention. `/users`, `/login`, `/system/users`, `/users/:id/edit`.
- **Localised path** - the version for a specific language. `/uporabniki`, `/prijava`, `/sistem/uporabniki`, `/uporabniki/:id/uredi`.

Internally, route handlers, helpers, and database calls work with canonical paths. URLs in HTML - links, form actions, redirect targets - should be localised so users navigate within their language. The `localized_path()` template helper is the bridge.

<a name="localized-path-helper"></a>

## The localized_path Helper

`localized_path(canonical)` returns the localised version of a canonical path for the active language:

```html
<a href="{~ localized_path('/login') }">Log in</a>
<a href="{~ localized_path('/profile') }">Profile</a>
<form method="POST" action="{~ localized_path(props.action) }">...</form>
```

Note the raw output tag `{~ }` - the localised path is HTML-safe by construction and shouldn't be double-escaped. (In particular, paths containing accented characters would get mangled if escaped.)

`localized_path()` handles three cases:

- **Exact canonical matches** - `/login` → `/prijava` (in Slovenian).
- **Routes with dynamic segments** - `/users/:id/edit` with `:id` placeholder → `/uporabniki/:id/uredi` (placeholders preserved).
- **Concrete URLs with values** - `/users/42/edit` → `/uporabniki/42/uredi` (values copied through to the matching positions).

If there's no localised version available (no `route_name` in any segment), it returns the canonical path unchanged.

<a name="automatic-route-registration"></a>

## Automatic Route Registration

In `server.ts`, two functions wire up the localisation at startup:

```ts
import { build_route_maps, expand_route_aliases_from_maps } from "$lib/route_map";

// Construct the canonical ↔ localised lookup tables
build_route_maps(translations, routes, active_languages);

// Register each route at every localised variant
const aliased_routes = expand_route_aliases_from_maps(routes, translations, active_languages);

const routed = wrap_all_routes(aliased_routes, set_lang(active_languages));
```

`expand_route_aliases_from_maps()` takes your canonical route table and produces an expanded table that includes every localised variant pointing to the same handler. The original canonical routes stay in place too - so `/login` and `/prijava` both work, both serve the same handler, both have the language resolved correctly.

The result: you write your route table once, in English, and every supported language has its routes registered automatically. Adding a new language requires no changes to `routes/routes.ts`.

<a name="language-detection-from-path"></a>

## Language Detection From Path

When a user lands on `/prijava`, the language middleware infers the language from the URL alone - no cookie or query parameter needed:

```ts
import { detect_lang_from_path } from "$lib/route_aliases";

const path_lang = detect_lang_from_path(url.pathname, translations);
// Returns "sl" for /prijava, "en" for /login, null for /api/...
```

If the path has a localised match in exactly one language, that's the language. If it matches in all languages (a route that isn't localised at all), the function returns `null` and the cookie or default determines the language.

The `set_lang` middleware uses path detection as priority #2 after the explicit `?lang=` query param. The resolution chain is documented in [Languages & Locales](/i18n/languages-and-locales#language-resolution).

<a name="the-lang-mismatch-dialog"></a>

## The Language-Mismatch Dialog

A user whose cookie says they prefer English can still land on `/prijava` - by clicking a Slovenian link in an email, by editing the URL, by sharing. To avoid silently switching languages, Reepolee's render layer detects the mismatch and exposes it to the layout:

- `props.path_lang` is the language detected from the URL.
- `props.lang_preferred` is the user's cookie-stored preference (set via `X-Lang-Preferred`).
- When they differ, additional fields are injected (`lang_mismatch_title`, `lang_mismatch_body`, `path_lang_name`, `lang_mismatch_switch`, `lang_mismatch_dismiss`) from the user's _preferred_ language translations.

The shipped layout (`routes/layout.ree`) renders the dialog and opens it with a one-line `showModal()` call:

```html
{#if props.path_lang && props.lang_preferred && props.path_lang !== props.lang_preferred }
<dialog id="lang_mismatch_dialog">
	<h2>{= props.lang_mismatch_title }</h2>
	<p>{= props.lang_mismatch_body } <strong>{= props.path_lang_name }</strong></p>
	<form method="dialog">
		<button>{= props.lang_mismatch_dismiss }</button>
	</form>
	<a href="?lang={= props.lang_preferred }">{= props.lang_mismatch_switch }</a>
</dialog>
<script>
	document.getElementById("lang_mismatch_dialog")?.showModal();
</script>
{/if }
```

The dialog uses **two native mechanisms**, no JavaScript needed beyond the `showModal()` call:

- **`<form method="dialog">`** - the dismiss button closes the dialog when submitted. The user stays on the URL's language; their cookie is unchanged.
- **`<a href="?lang=<preferred>">`** - the switch link triggers `set_lang` middleware to redirect to the same page in the user's preferred language and update the `lang` cookie.

The dialog renders in the user's _preferred_ language (so an English-speaker landing on a Slovenian page sees the dialog in English), making the offer comprehensible regardless of which side of the mismatch the user is on. See [Dialogs](/client-side/dialogs) for the general pattern.

<a name="redirecting-on-language-switch"></a>

## Redirecting on Language Switch

When `?lang=xx` is in the URL, the `set_lang` middleware does two things before letting the handler run:

1. **Resolves the canonical path** of the current URL (in case the user is on a localised version).
2. **Constructs the localised path** in the target language.
3. **Returns a `302` redirect** to the new URL, with the `lang` cookie set, and the `?lang=` query param stripped.

So `/login?lang=sl` becomes a redirect to `/prijava` with a `Set-Cookie: lang=sl` header. The URL the user sees is clean (no query param), shareable (links stay shareable across languages), and the cookie is updated so future visits use the same language.

<a name="the-route-map-api"></a>

## The Route-Map API

For programmatic localisation outside templates - constructing canonical-aware redirects, checking which language a URL belongs to, generating sitemap entries - the route-map module exposes its lookups:

```ts
import {
	resolve_canonical, // /prijava + "sl" → /login
	resolve_localized, // /login + "sl"           → /prijava
	detect_lang, // /prijava        → "sl" (or null)
	build_route_maps,
} from "$lib/route_map";

import { localized_url } from "$lib/helpers"; // wraps resolve_localized
```

`localized_url(path, lang)` is the handler-side equivalent of the `localized_path` template helper - it returns the localised path for a given language, preserving query strings. Use it when redirecting:

```ts
const lang = get_lang(req);
return Response.redirect(localized_url("/login", lang), 303);
```

Without `localized_url`, a Slovenian user who is logged out gets redirected to `/login` and immediately re-redirects through `set_lang` to `/prijava`. With it, the response goes straight to the localised URL.

<a name="non-localised-routes"></a>

## Routes You Don't Want to Localise

API endpoints, internal admin tools, anything machine-facing - these should usually stay canonical regardless of language. The way to skip localisation for a route is to leave the `route_name` key out of every language's translation file (or set the entire feature folder up without translation files at all).

`/api/users/:id` will work in every language, because no segment has a `route_name` translation. No redirect, no cookie change - just the route as written in `routes.ts`. Users (and external clients) see exactly one URL for each API endpoint.

For mixed cases - a page that should be localised but inside a section that isn't - give that page its own `route_name` translation. The route map walks segment-by-segment, so localising a leaf doesn't require localising the path above it.

<a name="pages-you-dont-want-to-localise"></a>

## Pages You Don't Want to Localise

Routes are about _which URLs_ resolve; this is about _content_. Some pages have the same body in every language - English-only documentation, an English-only engineering blog. They still need to be reachable under every language prefix (so a reader whose cookie says `sl` can open `/sl/blog/...` without their whole session flipping to English), but you don't want each prefix indexed as a separate page. Letting `/blog/post` and `/sl/blog/post` both into the index serves byte-identical content at two URLs, splitting ranking signals and burning crawl budget.

Mark such a page with `localize: false` in its frontmatter:

```markdown
---
title: "Why we bet on Bun"
localize: false
---
```

The SSG still renders every language variant, but the SEO signals change so the default language is the single canonical page:

- **`rel=canonical`** - each non-default variant (`/sl/blog/post`) emits `<link rel="canonical" href="https://…/blog/post/">` pointing at the default-language URL. This is the primary, correct deduplication signal: it tells Google the pages are the same and to credit the English one.
- **No hreflang cluster** - the page drops out of the `<link rel="alternate" hreflang="…">` set. Advertising a byte-identical page as a different language is a false signal, and Google discards hreflang clusters whose members canonicalize elsewhere - which would break hreflang for the page you _do_ want ranked.
- **Sitemap** - only the default-language `<loc>` is emitted; the other-language URLs are left out (see [`generate_sitemap.ts`](https://github.com/reepolee/reeweb/blob/main/scripts/generate_sitemap.ts)).

Reach for `localize: false` rather than `robots.txt` `Disallow` or a bare sitemap omission. A sitemap omission alone doesn't stop indexing - Google still finds the URLs through your internal links (the language switcher, the [language-mismatch dialog](#the-lang-mismatch-dialog)). And a `robots.txt` `Disallow` is worse here: it blocks the crawl, so Google can never _see_ the `rel=canonical` and may index the URL anyway without a snippet. Let the page be crawled and let the canonical do its job.

`localize: false` is independent of `route_name`: localise the _URL_ (so `/blog` reads naturally in each language) while keeping the _content_ single-canonical. The two settings compose.
