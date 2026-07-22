---
title: "Translations"
---

# Translations

<a name="introduction"></a>

## Introduction

Reepolee's translation system reads JSON files from `routes/` and merges them into a single nested object per language at server startup. There is no translation library, no extraction pipeline, and no compilation step - you write JSON, the server reads it, and templates pick up the strings through a small `translated_from_request()` helper.

Translation files live alongside the code they translate. The login form's strings are in `routes/system/auth/login/en.json` (and `sl.json`, and any other supported language). Global strings - the navigation labels, common button text, the language-mismatch dialog - live at `routes/en.json`. When the login route handler renders the form, it gets both layers merged automatically.

<a name="file-layout"></a>

## File Layout

The convention is one `<lang>.json` file per route folder, plus one at the root of `routes/` for global strings:

```
routes/
├── en.json                          ← global English strings
├── sl.json                          ← global Slovenian strings
├── home/
│   ├── en.json                      ← home-page English
│   └── sl.json
├── system/
│   └── auth/
│       ├── en.json                  ← auth-section English
│       ├── sl.json
│       ├── login/
│       │   ├── en.json              ← login-form English
│       │   └── sl.json
│       └── register/
│           ├── en.json
│           └── sl.json
└── users/
    ├── translations/                ← alternative: a "translations" subfolder
    │   ├── en.json
    │   └── sl.json
    ├── index.ts
    └── ...
```

Either layout works - the loader walks the directory recursively looking for `.json` files whose name matches one of the supported languages. The `translations/` subfolder convention is what the generator produces; hand-written routes typically put the JSON next to the handler.

<a name="file-contents"></a>

## What Goes in a Translation File

A typical file groups labels, error messages, and metadata under a small set of category keys. Here's `routes/en.json` (global strings):

```json
{
	"actions": {
		"save": "Save",
		"cancel": "Cancel",
		"back": "Back",
		"delete": "Delete",
		"confirm_delete": "Yes, do delete",
		"abort_delete": "No, do not delete"
	},
	"errors": {
		"required": "Required",
		"email_required": "Email is required",
		"email_invalid": "Must be a valid email address",
		"duplicate_key": "Code already exists"
	},
	"messages": {
		"record_created": "Record created",
		"record_updated": "Record updated",
		"record_deleted": "Record deleted"
	},
	"nav": {
		"home": "Home",
		"users": "Users",
		"email": "Email"
	},
	"search": {
		"search_term": "Search term ...",
		"submit": "Search"
	},
	"selectors": {
		"all": "All records",
		"per_page": "per page",
		"select": "-- Select --"
	},
	"ui": {
		"lang_mismatch_title": "Language mismatch",
		"lang_mismatch_body": "This page is in",
		"language_names": { "en": "English", "sl": "Slovenian" }
	},
	"route_name": ""
}
```

And `routes/system/auth/login/en.json` (route-specific):

```json
{
	"route_name": "login",
	"ui": {
		"title": "Login"
	},
	"fields": {
		"email": { "label": "Email" },
		"password": { "label": "Password" }
	},
	"actions": {
		"submit": "Login"
	},
	"errors": {
		"invalid_email_or_password": "Invalid email or password.",
		"account_not_verified": "Your account is not verified yet."
	}
}
```

Three things to notice:

- **`route_name`** is a reserved key - its value drives URL localisation. The Slovenian login file has `"route_name": "prijava"`, which makes `/login` reachable as `/prijava` in Slovenian. See [Localized Routes](/i18n/localized-routes).
- **Strings are grouped under intent buckets** (`actions`, `errors`, `messages`, `ui`, `fields`, `search`, `selectors`). The generator emits this shape, the handler validators pass `translated.errors` to `validate()`, and the templates read `props.actions.submit`, `props.errors.email_required`, etc. The grouping keeps a single category translatable as a unit and avoids name collisions between, say, a label and an error.
- **Nested objects work fine.** `fields.email.label` is the convention generated CRUD code expects - the form template reads `props.fields.email.label` for the email input's label.

<a name="conventions-for-keys"></a>

## Conventions for Keys

The generator produces a consistent shape across every route's translation file. Following it keeps your own translations easy to navigate and your handler code consistent:

| Top-level key | Contains                                                                 | Common consumer                             |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| `route_name`  | The localised URL segment (omit to keep canonical)                       | URL resolver                                |
| `ui`          | Headings, body copy, page title (`ui.title`), descriptive labels         | `props.ui.title`, `props.ui.*` in templates |
| `actions`     | Button text - `submit`, `save`, `cancel`, `delete`, `back`               | `props.actions.*`                           |
| `errors`      | Validation messages by rule key (`email_required`, `password_too_short`) | `validate(data, translated.errors)`         |
| `messages`    | Toast and confirmation strings (`record_created`, `successful_save`)     | Toast cookie payload                        |
| `fields`      | Per-field metadata: `{ field_name: { label, ... } }`                     | Form templates                              |
| `search`      | Search-form copy                                                         | List page templates                         |
| `selectors`   | Dropdown options (yes/no, per-page)                                      | List page templates                         |
| `nav`         | Navigation menu entries (often nested)                                   | Layout templates, `nav_label()` helper      |

For your own keys, prefer:

- Snake_case for keys (`record_updated`, `email_not_sent`).
- Lowercase, no punctuation. The capitalisation of the displayed string lives in the value.
- One translation file per natural unit of work - a route handler's concerns, mostly. Avoid sprinkling the same translation across multiple files because then changing it requires changing both.

<a name="reading-translations-in-handlers"></a>

## Reading Translations in Handlers

`translated_from_request(req, import.meta.dir)` from `$lib/helpers` is the single function every handler calls. It does three things:

1. Reads the active language from the request (`X-Lang` header → cookie → default).
2. Looks up the route's namespace from `import.meta.dir` (e.g. `system/auth/login`).
3. Merges the route-specific translations on top of the global ones.

```ts
import { translated_from_request } from "$lib/helpers";
import { render } from "$lib/render";
import { create_ctx } from "$lib/request_context";

export async function get_auth_login(req: BunRequest): Promise<Response> {
	const ctx = await create_ctx(req);
	const translated = await translated_from_request(req, import.meta.dir);

	return render("system/auth/login/form", {
		data: {
			action: "/login",
			...translated,
		},
		ctx,
	});
}
```

Spreading `translated` into `props` means the template can access every key directly:

```html
<h1>{= props.ui.title }</h1>
<label>{= props.fields.email.label }</label>
<button type="submit">{= props.actions.submit }</button>
```

No nested object lookups, no per-key fallbacks. If a key is missing, the merge step ([Fallback Merge](#fallback-merge) below) handles it; if it's truly absent in every language, the template renders an empty string and the missing label is visible during testing.

<a name="loading-and-namespaces"></a>

## How Files Are Loaded

`lib/i18n.ts` walks `routes/` at server startup. For each JSON file it finds:

1. The language code comes from the filename (`en.json` → `en`).
2. The namespace comes from the directory path. `routes/system/auth/login/en.json` becomes the namespace `system.auth.login`; `routes/en.json` becomes the namespace `routes` (a special name that holds the global strings).
3. The file contents are nested under that namespace in the language's tree.

For files inside a `translations/` subfolder, the `translations` segment is stripped - `routes/users/translations/en.json` becomes the namespace `users`, not `users.translations`.

The final structure looks like:

```js
{
    en: {
        routes: {                    // global strings from routes/en.json
            actions: { save: "Save", ... },
            errors:  { required: "Required", ... },
            nav:     { home: "Home", ... },
        },
        system: {
            auth: {                  // from routes/system/auth/en.json
                route_name: "auth",
                login: {             // from routes/system/auth/login/en.json
                    ui:      { title: "Login" },
                    fields:  { email: { label: "Email" }, ... },
                    actions: { submit: "Login" },
                    errors:  { invalid_email_or_password: "...", ... },
                },
            },
        },
        users: { ... }
    },
    sl: { ... }
}
```

`translated_from_request()` looks up the route's namespace (e.g. `system.auth.login`) and merges it on top of the global `routes` namespace.

<a name="fallback-merge"></a>

## Fallback Merge

After all files are loaded, the system fills in missing keys across languages so a partially-translated file doesn't produce empty strings. The rule is straightforward: for each language and each top-level namespace, any key that's missing or empty in that language is filled from any other language that has it.

The exception is `route_name` - it is _never_ inherited from another language. A missing `route_name` means "use the canonical English segment for the URL," not "use the Slovenian segment." This is what lets you ship the English version of an app before translating any URLs and still have working routes.

In practice, this means:

- **Untranslated strings show up in another language** rather than as blanks. You see them while testing and know they need translation.
- **Untranslated URLs stay canonical**. You can add Slovenian support to a route incrementally - translate the strings first, leave the URLs canonical, add a localised `route_name` later.
- **The fallback is implicit, not configured.** There's no preferred-fallback-language setting; whichever language has the value provides it.

<a name="synchronising-keys"></a>

## Synchronising Keys Across Languages

When you add a new key to `en.json`, the other language files don't pick it up automatically - they have to mention it (with a value or as an empty string) to override the English fallback.

The `bun generator/sync_translations` script handles this. It walks every `translations/` folder, identifies keys present in `en.json` but missing in other language files, and marks them with a placeholder:

```bash
bun generator/sync_translations
```

Missing keys appear in the file as `"::missing_<lang>_<key>::"`. Search the codebase for `::missing_` to find every string still to translate. Once you've replaced the placeholder, the next sync run leaves it alone.

For applications with many languages, the generator's `--translate` flag (covered in [Generators](/database/generators#translations)) calls an LLM to fill in missing translations automatically. You still review the result, but the first pass is no longer manual.

<a name="adding-new-strings"></a>

## Adding New Strings

The flow for adding a string to an existing route:

1. **Add the key to every supported language file.** Even just adding it to `en.json` works (the fallback fills the rest), but explicitly translating it is better.
2. **Reference it in your handler.** `translated.your_new_key` is available as soon as you've spread `translated` into `props`.
3. **Use it in your template.** `{= props.your_new_key }` (escaped) or `{~ props.your_new_key }` if it contains trusted HTML.

That's the whole flow. No static-generation step, no extraction tool, no codegen.

For a global string that should be available on every page, add it to `routes/en.json` (and the equivalent file for every language). For a string specific to one route, add it to that route's `en.json`.

<a name="reloading-translations-in-development"></a>

## Reloading Translations in Development

Translation files are read at server startup. A change to `en.json` while the server is running won't appear until the server reloads. In development, the file watcher already restarts the process on file changes, so editing a translation file and refreshing the page picks up the new value automatically.

For manual reloads (without restarting), call `reload_all_translations()` from `$lib/i18n`:

```ts
import { reload_all_translations } from "$lib/i18n";

// in a development-only route
export async function get_dev_reload_translations(req: BunRequest): Promise<Response> {
	await reload_all_translations();
	return new Response("Reloaded", { status: 200 });
}
```

This is useful for editors that don't trigger Bun's file watcher (a remote editor, a script that writes the file from outside the project). For local development with the default watcher, you don't need it.
