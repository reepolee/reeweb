---
title: "Languages & Locales"
---

# Languages & Locales

<a name="introduction"></a>

## Introduction

Reepolee ships with a complete internationalisation system: translated strings per-route and globally, locale-aware date and currency formatting, language-localised URLs, and a mismatch dialog when the page's language doesn't match the user's preferred one. All of it runs server-side - there is no client-side translation step and no JSON to ship to the browser.

This page covers the configuration: which languages are supported, how the default is chosen, and how the active language is resolved on each request. The other two i18n pages cover translation files ([Translations](/i18n/translations)) and language-localised URLs ([Localized Routes](/i18n/localized-routes)).

<a name="the-config-file"></a>

## The Config File

Languages are declared in `config/supported_languages.ts`:

```ts
// All translations that exist in the codebase
export const languages = ["en", "sl"] as const;

// Languages the user can pick (subset of `languages`)
export const active_languages = ["sl", "en"] as const;

// First served when no preference is known
export const default_language = "sl";

export const language_names: Record<string, string> = {
	en: "English",
	sl: "Slovenian",
};

export const language_locales: Record<string, string> = {
	en: "en-US",
	sl: "sl-SI",
};
```

Each export has a specific purpose:

- **`languages`** - every language code that has translation files in the project. The translation loader walks `routes/` looking for `<code>.json` files matching this list.
- **`active_languages`** - what the language picker offers users. Usually equal to `languages`, but can be narrower while you're translating a new language behind the scenes.
- **`default_language`** - what gets served when no `?lang=...` query param, no `lang` cookie, and no language-localised URL match are available.
- **`language_names`** - display labels for the language picker.
- **`language_locales`** - the BCP-47 locale code used for date and currency formatting. `en` and `en-US` look the same; `sl` and `sl-SI` differ in date order and number separators.

Adding a new language is four changes - extend `languages`, optionally extend `active_languages`, add the display name and locale, then drop a `<code>.json` file in `routes/` and any feature folders that need translation. The fastest path is `bun tui` → **Add language**, which makes the config edit, creates the stub JSON files in every route folder, and optionally runs the OpenRouter translation pass in one step. See [Adding a New Language](/recipes/new-language) for the full walkthrough.

<a name="language-resolution"></a>

## Language Resolution

On every request, the `set_lang(active_languages)` middleware resolves the active language and sets the `X-Lang` header on the request. The render layer reads `X-Lang` and uses it to choose the right translations.

The resolution order is:

1. **`?lang=xx` query parameter** - explicit user choice. Always wins. Also sets the `lang` cookie and redirects to the localised URL.
2. **Language detected from the URL path** - e.g., `/avtentikacija/prijava` is detected as Slovenian. See [Localized Routes](/i18n/localized-routes).
3. **`lang` cookie** - the user's previous choice.
4. **`default_language`** - final fallback.

The middleware also writes a second header, `X-Lang-Preferred`, that carries the user's cookie-stored preference (regardless of the resolved page language). This is what powers the language-mismatch dialog: if the page is in Slovenian but the user's cookie says they prefer English, the layout can offer to switch.

<a name="reading-the-active-language"></a>

## Reading the Active Language in Handlers

Most handlers don't need to read the language directly - they call `translated_from_request(req, import.meta.dir)` and get the merged translation object back. When you do need the raw code:

```ts
function get_lang(req: BunRequest): string {
	return req?.headers?.get("X-Lang") || "en";
}
```

The pattern is one line because `set_lang` middleware has already done the work. Reading the cookie or query param directly is unnecessary - and would skip the localised-URL path detection.

In templates, `props.lang` is the active language code and `props.locale` is the corresponding BCP-47 locale. Both are injected automatically by `render()`:

```html
<html lang="{= props.lang }">
	...
	<p>{= js_date_to_locale_string(record.created_at) }</p>
	<!-- locale_date uses props.locale by default -->
</html>
```

The `props.active_languages` and `props.language_names` exports are also pre-populated in every render, so the language picker doesn't need a per-handler `props` entry - it's already there.

<a name="creating-a-language-picker"></a>

## Creating a Language Picker

A complete picker that uses the canonical-to-localised URL helper:

```html
<nav class="flex gap-2 text-sm">
	{#each props.active_languages as code }
	<a
		href="{~ localized_path(props.request_url) }?lang={= code }"
		class="{= props.lang === code ? 'font-bold' : 'text-muted' }"
	>
		{= props.language_names[code] }
	</a>
	{/each }
</nav>
```

Two things to notice:

- **`localized_path(props.request_url)`** ensures the URL stays on the current page - if you're on `/prijava` (the Slovenian login URL) and click "English," the link goes to `/login`, not the homepage.
- **`?lang={= code }`** is what tells `set_lang` to switch. The middleware sees the query param, sets the cookie, and redirects to the right localised URL.

The picker has no JavaScript. The query param + redirect approach means every link is shareable - copying a `?lang=en` URL into chat sends the recipient the English version regardless of their cookie.

<a name="locale-aware-formatting"></a>

## Locale-Aware Formatting

The built-in template helpers use `props.locale` (derived from `props.lang`) for date and number formatting automatically:

```html
<p>{= js_date_to_locale_string(record.created_at) }</p>
<!-- en: "1/15/2026" - sl: "15. 1. 2026" -->

<p>{~ display_currency(record.price) }</p>
<!-- en: "€1,234.56" - sl: "1.234,56 €" -->
```

For one-off formatting in custom helpers or in the route handler, use `props.locale` directly:

```ts
new Intl.NumberFormat(translated.locale, { style: "decimal" }).format(value);
```

This way the formatting always matches the user's language without having to pick the locale string by hand.

<a name="when-no-language-fits"></a>

## When Translation Is Missing

If a user requests `?lang=fr` and `fr` isn't in `active_languages`, the middleware ignores the query param and falls through to the cookie or default. The same holds for the cookie - if a user's cookie says `fr` and you remove `fr` from `active_languages`, the next request resolves to the default.

If a translation key is missing in the active language but present in another, the missing-fill step (covered in [Translations](/i18n/translations#fallback-merge)) copies the value from a language that has it. The user sees the key in some language rather than seeing nothing - usually the right trade-off while translations are being filled in.

<a name="server-startup"></a>

## What Happens at Server Startup

`config/supported_languages.ts` is read once on import. `lib/i18n.ts` walks `routes/` and constructs the translation tree at module load. `lib/route_map.ts` constructs the localised-URL lookup tables in `server.ts`:

```ts
build_route_maps(translations, routes, active_languages);
const aliased_routes = expand_route_aliases_from_maps(routes, translations, active_languages);
const routed = wrap_all_routes(aliased_routes, set_lang(active_languages));
```

So every `routes/routes.ts` entry - `/users`, `/login`, `/profile` - is automatically registered at every localised variant (`/uporabniki`, `/prijava`, `/profil`) without you writing additional route entries. The handler is the same; the path is different per language. See [Localized Routes](/i18n/localized-routes).
