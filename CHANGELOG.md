# Changelog

## 2026-07-21 - Static search

- **`bun ssg:search`** - `scripts/generate_search_index.ts` walks the rendered HTML in `dist/` and emits a section-level `search-index.json`, split at h1-h3 heading ids so results deep-link to the matching section. Runs as the last step of `bun ssg`. Drafts, future-dated and `noindex` pages are excluded, matching the sitemap's visibility rules.
- **`config/search.ts`** - toggles search and describes the sources to index. The default is a single whole-site index at `/search-index.json`; add sources to emit one index per section, each with its own results group.
- **`<site-search>` component** - the Cmd/Ctrl+K dialog, with the trigger button, focus trap, and Escape/backdrop close. Drop it into a layout once.
- **`src/public/js/site-search.js`** - fetches the index on first focus, then does fuzzy scoring, match highlighting, and arrow-key result navigation. No dependencies.

## 2026-07-21 - Beta status

- Standardized the project maturity label as Beta across repository and website-facing documentation.
- Kept the pre-1.0 compatibility caveat while simplifying the maturity label.

## 2026-07-10 - Distribution path update

- **Local release output by default** - the release command now writes to ReeWeb's ignored `dist/` directory instead of the public website's download assets.

## 2026-07-09 - Documentation audit cleanup

- **Architecture docs refreshed** - `docs/ARCHITECTURE.md` now lists the current `scripts/ssg/`, `scripts/dev/`, and `scripts/shared/` module split and removes the stale `.oxlintrc.json` reference.
- **Stale agent plans removed** - old `.agents/PLAN_*.md` files were deleted after their resolved and open items were consolidated into `docs/OPEN_ISSUES.md`.

## 2026-07-01 - Code style enforcement + launcher removal

- **vendor_check.ts: full snake_case compliance** - all functions, variables, parameters, and type properties renamed to snake_case. Ensures server-side TypeScript adheres to AGENTS.md conventions.
- **Removed stale launcher references** - `bun run launcher` command no longer exists; removed from AGENTS.md, llms.txt, DEVELOPMENT_GUIDE.md, ARCHITECTURE.md. Also removed orphaned dev_watcher.ts file reference from file structure docs.

## 2026-07-01 - Vendor checker + documentation cleanup

- **`bun vendor:check` script added** - auto-discovers vendor files (`.min.js`, `.bundle.js`) and matches them with `get:*` scripts in package.json. Checks for orphaned files and outdated devDependencies.
- **Simplified SSG scripts** - removed a redundant generation command; now use `bun run ssg` for full production generation (images + CSS + sitemaps + RSS).
- **Documentation updated** - README.md, AGENTS.md, DEVELOPMENT_GUIDE.md now reflect current commands and include `vendor:check` in command tables. Removed stale SSG-command references.

## 2026-06-17 - Modular template engine (shared with Reepolee)

Adopted Reepolee's modular template engine so both projects share one identical codebase. The monolithic `lib/template_engine.ts` was split into a thin orchestrator plus focused modules, and several behaviour changes that had landed upstream come with it.

### Changed files

| File                                | Change                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `lib/template_engine.ts`            | Reduced to an orchestrator (load, render, cache) that delegates to `lib/template/`                  |
| `lib/template/compiler.ts`          | New - directives → async render function (each/if/with/layout/include, code generation)             |
| `lib/template/custom_elements.ts`   | New - HTML-comment stripping, `<tag-name>` pre-processing, spread shorthand, attribute parsing      |
| `lib/template/include_handler.ts`   | New - runtime include dispatch (async file checks)                                                  |
| `lib/template/include_resolver.ts`  | New - pure path/alias resolution                                                                    |
| `lib/template/types.ts`             | New - shared `CompiledFn` / `ResolveResult` types                                                   |
| `lib/template_engine.test.ts`       | New - engine test suite (ported from Reepolee, 53 tests)                                            |
| `REE_TEMPLATES.md`, `README.md`, `AGENTS.md` | Documented the modular layout and the behaviour changes below                              |

### Behaviour changes (not a pure refactor)

- **`{@componentName(...)}` shorthand removed.** Components are invoked **only** as custom elements (`<component-name>`). A literal `{@…}` now passes through as text. Reeweb had zero `{@…}` usages, so no templates broke.
- **Attribute interpolation added.** An attribute written `attr="{= expr }"` (or `{~ expr }`) is now evaluated where the tag sits and delivered under `props.attributes` - previously the literal string was passed. This is how dynamic per-call/per-item data reaches a component.
- **`{#with expr } … {/with }` added.** Opens a `with`-scope for unqualified member access; no `{:else}`.
- **HTML comments are stripped during template compilation.** `<!-- … -->` is removed before compilation and tags inside comments are not evaluated. *Output change:* comments no longer appear in rendered HTML (affected the academic-paper sample's section labels).
- **`{#if}` is resilient at render time.** A condition that throws is caught and treated as falsy instead of crashing the render.
- **Native (non-component) custom elements** now compile their slot inline (shares scope) rather than via an isolated slot function.
- Component custom elements compile through an internal NUL-marker, replacing the previous `{@…}` intermediate step.

### Verification

`bun run ssg` output is identical to before except for the now-stripped HTML comments; `bun test lib/template_engine.test.ts` passes (53/53). Engine files are byte-identical to Reepolee's.

## 2026-05-29 - Template data rename, attribute handling & spread shorthand

### Changed files

| File                                 | Change                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `lib/template_engine.ts`             | `data` → `props` rename; custom element attrs wrapped under `attributes: {}`; `...rest` spread shorthand pre-processor |
| `lib/template_helpers.ts`            | `key_values()` now quotes attribute values                                                                             |
| `src/components/my-h1.ree`           | Simplified to use `...rest` shorthand, removed debug log                                                               |
| `src/components/banner.ree`          | Refactored to destructure `props.attributes`, use `...rest` shorthand                                                  |
| `internal/*.ree` (9 files, ~80 refs) | `data.` → `props.` in all templates                                                                                    |
| `public/docs/*.md` (5 files)         | Code examples updated to `props` convention                                                                            |
| `REE_TEMPLATES.md`                   | Documented props convention, spread shorthand and `props.attributes`                                                   |
| `AGENTS.md`                          | Updated conventions, data loading docs, and component docs                                                             |
| `CHANGELOG.md`                       | New - this file                                                                                                        |

### `data` → `props` rename

All template data references renamed from `data.` prefix to `props.` for clarity and consistency with component convention.

- **Engine**: `render(name, data)` → `render(name, props)`, all internal parameter names updated
- **Templates**: `{= data.title }` → `{= props.title }`, `{#each data.items}` → `{#each props.items}`, etc.
- **Docs**: All code examples across 5 doc files updated
- **`AGENTS.md`**: New rule documented in conventions section

### `props.attributes` - Wrapped HTML attributes for custom elements

Custom element HTML attributes (from `<my-h1 class="foo">` syntax) are now grouped under `props.attributes` instead of being spread directly on the `props` object.

- **Engine**: Custom element pre-processor wraps parsed attributes under `attributes: { ... }`
- **Components**: Access specific attrs via destructuring (`const { class: _class, ...rest } = props.attributes`)

### `key_values()` - Quoted attribute values

The `key_values()` helper now wraps values in double quotes, fixing broken rendering for attributes with spaces (e.g., `style="background: red; padding: 2rem"`).

### `...identifier` spread shorthand

Bare `...identifier` in template output is automatically converted to `{~ key_values(identifier)}` during compilation - a shorthand for spreading an object of HTML attributes onto an element.

- **Engine**: Regex-based pre-processing step, preserves `{{ }}` blocks unchanged
- **Pattern**: `const { type, text, ...rest } = props.attributes;` → `<div class="..." ...rest>`

### Components simplified

- **`my-h1.ree`**: Uses `...rest` shorthand instead of `{~ key_values(rest)}`. `console.log` debug line removed.
- **`banner.ree`**: Destructures `{ type, text, ...rest }` from `props.attributes`, passes through extra attributes via `...rest`.
