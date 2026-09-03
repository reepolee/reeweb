# Data Loading

## `load_template_data()`

Templates can have a sibling `.ts` file exporting `load_template_data()`:

```typescript
// src/public/index.ts (sibling to src/public/index.ree)
export async function load_template_data({ locale }: { locale: string }): Promise<Record<string, any>> {
    return { posts: await fetchPosts(locale) };
}
```

Called with the page's locale on every request in `bun run dev` and once per page (per locale) during `bun run ssg`. Failures are caught, logged, and return `{}` so a broken data file never takes down the page. The returned data is merged into the render context and accessed via `props`:

```ree
<h1>{= props.site_name }</h1>
{#each props.posts as post}
  <article>{= post.title }</article>
{/each}
```

---

## Built-in props

Every template has these variables available under `props`:

| Prop | Description |
| --- | --- |
| `props.locale` | Active BCP-47 locale (e.g. `"en-us"`, `"sl-si"`) - the single localization axis |
| `props.lang` | Same value as `props.locale` - kept so the shared template engine's `props.lang`-based localized-variant resolution (`lib/template_engine.ts`) still works |
| `props.html_lang` | Short language subtag (e.g. `"sl"`) for the `<html lang="...">` attribute only |
| `props.helpers` | Object of helper functions (passed from SSG script) |
| `props.site_name` | Site name from config |
| `props.year` | Current year for copyright |
| `props.canonical_path` | Current page's canonical URL path |
| `props.body` | Rendered body content (in layout templates) |
| `props.translations` | Merged translation tree for the current locale (from `{locale}.json` files); conventionally holds `ui` and `nav` sections, read via the `{_ }`/`{- }`/`{@ }` tags as e.g. `{_ ui.title }` (resolves `props.translations.ui.title`) |

Component files (`src/components/*.ree`) receive data via:
- `props.children` - slot content
- `props.attributes` - object of HTML attributes from the custom element call

Use destructuring and `...rest` to consume known attributes and spread the rest:

```ree
{{
const { children } = props;
const { class:_class, type, ...rest } = props.attributes;
}}
<h1 class="{= _class}" ...rest>{~ children }</h1>
```

---

## Fetching from reepolee

`src/lib/reepolee_api.ts` exports two functions. `locale` is required on both - reepolee stores
content in locale-suffixed tables and rejects a request with no (or unsupported) locale:

```typescript
fetch_collection(route_path, locale, opts?)   // → { data, total, limit, offset }
fetch_record(route_path, id, locale)          // → record | null
```

Example (the starter's `src/public/index.ts` ships this pattern commented out as a reference):

```typescript
import { fetch_collection } from "../lib/reepolee_api";
import { handle_dynamic_assets } from "../lib/dynamic_assets";

export async function load_template_data({ locale }: { locale: string }): Promise<Record<string, any>> {
    let team: any[] = [];
    try {
        const team_result = await fetch_collection("/team", locale);
        team = await handle_dynamic_assets(team_result.data);
    } catch (err) {
        console.warn("[reeweb] Could not fetch team from local reepolee server:", (err as Error).message);
    }
    return { team };
}
```

Requires reepolee in agent mode. See [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#reepolee-api-integration) for setup.

Before rendering, `bun run dynamic:sync` reads the Reepolee
`/images` and `/files` JSON APIs. It mirrors those registered
assets into `assets/images/dynamic/` and `assets/files/dynamic/`. The normal
responsive-image preparation task then processes the synchronized images.
When `REEPOLEE_API_URL` is not configured, synchronization reports that it was
skipped and leaves the local dynamic asset folders untouched.

`handle_dynamic_assets()` does not fetch data or files. It recursively rewrites
fields ending in `_image` or `_file` using the synchronized local files. The
returned values are local public URLs with content fingerprints. Synchronization
compares each API record's `s3_key` and `updated_at` with the local dynamic
folders, so it downloads only added or changed assets and deletes candidates
removed from Reepolee. Use `bun run dynamic:sync --force` to download every
candidate when storage changed outside Reepolee. JPG, JPEG, PNG, and WebP image
originals are supported. A WebP original receives a distinct `.jpg` fallback
base URL for the responsive-image helpers.

> Always use a relative import (`../lib/reepolee_api`), not the `$lib` path alias. Path aliases are resolved by `tsconfig.json` but break in dynamic `file://` imports used by the dev server's module cache-busting.
