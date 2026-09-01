# Content Collections

Collections with TypeScript schemas. A folder under `src/public/` becomes a **collection** the moment it contains a `_schema.ts` exporting a Zod `schema` - no central registry needed.

```ts
// src/public/blog/_schema.ts
import { z } from "$vendor/zod.min.js";
export const schema = z.object({
    title:        z.string().min(1),
    published_at: z.coerce.date(),        // accepts Date or "YYYY-MM-DD"
    authors:      z.array(z.union([z.string(), z.object({ name: z.string() }).passthrough()])).optional(),
}).passthrough(); // keeps built-in/per-post extras
```

---

## How it works

- **When:** `scripts/ssg.ts` validates every entry's frontmatter before rendering. Any violation prints an aggregated report and exits non-zero - the broken site never ships.
- **Required vs optional:** fields without `.optional()` are mandatory. A missing or wrong-type field fails the SSG pass.
- **Zod is vendored** at `vendor/zod.min.js` (`$vendor/zod.min.js`). Re-fetch with `bun run get:zod` (pinned to `zod@4.4.3`). Validation runs only during SSG - zero runtime dependency.
- **`_schema.ts` never ships** to `dist/` (`.ts` files are excluded from static copy).
- **Tested:** `validate_entries()` lives in `scripts/ssg/collections.ts`, re-exported from `scripts/ssg.ts`. The SSG body runs only under `import.meta.main`, so importing for tests is side-effect-free. See `scripts/ssg.test.ts`.

---

## Engine gotcha

> The template preprocessor scans **inside `{{ }}` JS comments** too.
> Never put markup-like tokens (`<some-tag>`, `{= ... }`, `{{`) in component comments - they get compiled and split the block.
