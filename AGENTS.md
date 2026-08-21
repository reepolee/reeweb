# reeweb - Agent Guide (Index)

First, read and respect ~/.agents/AGENTS.md

> This file is an **index**, not a manual. It points you at the docs and the code.
> Read it first, then **read the actual code** for the area you're touching.
> **Agent-created documents go in `.agents/`.** All plans, notes, logs, working docs—everything an agent writes goes there.

## ⚠️ PRIMARY RULE: CODE IS THE SOURCE OF TRUTH

**When any document (including this one) disagrees with the code, the code wins.**

Docs drift. Treat every `.md` file as a *map*, not gospel. Before you act on anything a
doc claims (a path, a function name, a flag, a default), **open the file and confirm it
in the source.** Workflow:

1. Read this index to find *where* the relevant code lives.
2. Read that code (and its co-located `*.test.ts`) to learn how it *actually* behaves.
3. Only then make a change.
4. If you find a doc that no longer matches the code, fix the doc (or flag it) - don't propagate the stale claim.

The one thing docs are authoritative for is **project policy you cannot derive from code**
(conventions, the file-first translation rule, "fix generators not generated code"). Those
rules live below and in the linked guides - follow them.

- `lib/` is the upstream library - never edit it directly. Put project code in `src/lib/`.
- The shared `.ree` engine (`lib/template_engine.ts`, `lib/template/*`, `lib/template_engine.test.ts`) is shared with the canonical reepolee repo. The projects are expected to **diverge naturally** as each adds its own needs - divergence is not an error. Run `bun run engine:check` to review where the local copy has drifted; it compares against a sibling checkout, checked in this order: `$REEPOLEE_DIR`, `../reepolee-dev` (reepolee's dev checkout), then `../reepolee` (the public-release sibling). It ignores comment and reettier-formatting differences, writes the full diff to `engine_drift.diff`, and exits 0 unless `--enforce` is passed (use `--enforce` in CI when strict parity is wanted).
- One shared file is **deliberately not** byte-identical and is excluded from the check:
  - `lib/template/helper_names.ts` - deliberately **not** in `SHARED_ENGINE_FILES`. `DEFAULT_HELPER_NAMES` is the injected system-helper set; project helpers stay reachable as `helpers.<name>`. The two projects' lists differing is **intended, not drift** - do not "reconcile" them, and do not add this file to the checker (it would go permanently red over an intentional difference). A name listed without an implementation in that project is a not-yet-implemented system helper, not dead code.

---

## Commands

| Purpose | Command |
| --- | --- |
| Dev (fast) | `bun dev` |
| Dev (server only) | `bun run development` |
| Rendering for production | `bun run ssg` |
| Render a single page to stdout (fast feedback loop) | `bun run ssg:print-url /some/path` |
| CSS build (minified) | `bun run css:build` |
| Format | `bun run format` (reettier) |
| Vendor check | `bun run vendor:check` |
| Naming check (snake_case) | `bun run naming:check` |
| Test | `bun test` |
| Preview | `bun run preview` |

See `package.json` `scripts` for the full list.

**`bun run ssg:print-url <path>` is the fast way to check a `.ree`/`.md` page edit** - it renders just that one route and prints the HTML to stdout, instead of running a full `bun run ssg` generation and grepping `dist/`. In Git Bash on Windows, prefix with `MSYS_NO_PATHCONV=1` or Git Bash mangles the leading `/` into a Windows path (e.g. `MSYS_NO_PATHCONV=1 bun run ssg:print-url /docs/reeweb`). Add `--dev` to render with `is_dev: true` so dev-only template blocks (e.g. `{#if props.is_dev}`) show in the output.

Per the global "use a different PORT" rule: this dev server kills whatever already holds its port on startup (`scripts/dev/port_release.ts`), so use `bun run development -- --port 3099` (note the `--` so `bun run` forwards the flag) or `bun scripts/dev.ts --port 3099` directly.

---

## Where to look

| Doc | Use it for |
| --- | --- |
| [README.md](README.md) | Setup, prerequisites, full CLI reference |
| [internals/ARCHITECTURE.md](internals/ARCHITECTURE.md) | SSG pipeline, dev server, template engine, file structure |
| [internals/DEVELOPMENT_GUIDE.md](internals/DEVELOPMENT_GUIDE.md) | Dev modes, project hooks, reepolee API integration, testing |
| [internals/DATA_LOADING.md](internals/DATA_LOADING.md) | `load_template_data()`, built-in props, fetching from reepolee |
| [user-manual/COLLECTIONS.md](user-manual/COLLECTIONS.md) | Content collections - Zod schema validation at SSG |
| [user-manual/REE_TEMPLATES.md](user-manual/REE_TEMPLATES.md) | `.ree` engine - stub -> website + Reepolee internals |
| [user-manual/I18N.md](user-manual/I18N.md) | i18n - stub -> website (languages, translations, routes) |
| [user-manual/PAGINATION.md](user-manual/PAGINATION.md) | Static pagination - stub -> website |


## Context & Pattern Principles (Anti-Anchoring Guardrails)

### 1. Source of Truth & State Hierarchy
- **Current Constraints Over Repository Examples:** Treat existing codebase implementation patterns as historical context, NOT absolute authority. If existing code uses deprecated APIs, anti-patterns, or legacy syntax, DO NOT replicate them simply because they exist in the repository.
- **Evaluation Order:** Always evaluate solutions against current runtime specifications, framework best practices, and explicit project guidelines BEFORE referencing surrounding code style.

### 2. Modern Standards & Deprecation Awareness
- **Identify and Isolate:** Before writing code, actively check if the surrounding file uses deprecated libraries, outdated language syntax, or anti-patterns (e.g., callbacks vs. async/await, outdated state management, deprecated SDK methods).
- **Refactor Scope:** Do not passively propagate bad patterns to new code. If a new function touches a file with outdated patterns:
  - Implement the new functionality using modern standards.
  - Do NOT rewrite unrelated code unless explicitly instructed (avoid scope creep).
  - Bridge the modern implementation to the existing caller cleanly.

### 3. Disregard Historical Context Traces
- **Ignore Git Churn & Historical Comments:** Ignore outdated TODOs, commented-out dead code, and historical workarounds unless directly relevant to the target bug.
- **Ignore Discarded Patterns:** If past commits or adjacent files demonstrate trial-and-error attempts, treat them as failed experiments—do not attempt to re-implement or adapt them.
- **Focus:** Strictly on the current code state (HEAD). Do not match outdated patterns unless specifically asked.

### 4. Code Generation Rules
- **Modern Defaults First:** Always default to modern idiomatic practices (e.g., strict typing, explicit immutability, modern error handling).
- **Explicit Warning:** If forced to use an outdated pattern due to tight coupling, flag it explicitly with a comment: `// COMPATIBILITY: [Reason]`.
