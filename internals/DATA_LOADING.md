# Data Loading

## `load_template_data()`

Templates can have a sibling `.ts` file exporting `load_template_data()`:

```typescript
// src/public/index.ts (sibling to src/public/index.ree)
export async function load_template_data(): Promise<Record<string, any>> {
    return { posts: await fetchPosts() };
}
```

Called on every request in `bun run dev` and once per page during `bun run ssg`. Failures are caught, logged, and return `{}` so a broken data file never takes down the page. The returned data is merged into the render context and accessed via `props`:

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
| `props.lang` | Active language code (e.g. `"en"`, `"sl"`) |
| `props.locale` | BCP-47 locale string (e.g. `"sl-SI"`) |
| `props.helpers` | Object of helper functions (passed from SSG script) |
| `props.site_name` | Site name from config |
| `props.year` | Current year for copyright |
| `props.canonical_path` | Current page's canonical URL path |
| `props.body` | Rendered body content (in layout templates) |
| `props.ui` | UI translation strings (from `{lang}.json` files) |
| `props.nav` | Navigation labels (from `{lang}.json` files) |

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

`src/lib/reepolee_api.ts` exports two functions:

```typescript
fetch_collection(route_path, opts?)   // → { data, total, limit, offset }
fetch_record(route_path, id)          // → record | null
```

Example (the starter's `src/public/index.ts` ships this pattern commented out as a reference):

```typescript
import { fetch_collection } from "../lib/reepolee_api";

export async function load_template_data(): Promise<Record<string, any>> {
    let team: any[] = [];
    try {
        const team_result = await fetch_collection("/team");
        team = team_result.data;
    } catch (err) {
        console.warn("[reeweb] Could not fetch team from local reepolee server:", (err as Error).message);
    }
    return { team };
}
```

Requires reepolee in agent mode. See [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#reepolee-api-integration) for setup.

> Always use a relative import (`../lib/reepolee_api`), not the `$lib` path alias. Path aliases are resolved by `tsconfig.json` but break in dynamic `file://` imports used by the dev server's module cache-busting.
