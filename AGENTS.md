# reeweb - Agent Guide (Index)

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
(conventions, the DB-first translation rule, "fix generators not generated code"). Those
rules live below and in the linked guides - follow them.

## ⚠️ MUST FOLLOW (workflow)

- Just answer questions - don't assume a code change. Ask approval before acting.
- **Commit before starting work if stale.** Check `git log -1 --format=%ct`. If more than 600 seconds have passed since the last commit, commit the current state first.
- **Fix generators, not generated code.** This is a codegen app. Never edit generated code unless explicitly instructed - fix the generator instead.
- **When planning** (PLAN MODE, PLAN:, PLAN IT), write the plan to `PLAN_{topic}.md` and refine it there.
- **When checking/reviewing/finding**, do not code. Research and report with possible follow-ups.

## Conventions (ABSOLUTELY MUST FOLLOW)

- **Bun native APIs only.** Zero runtime dependencies; only `tailwindcss` and `@types/bun` as dev deps.
- **Fail loudly if an `.env` var is not set. No fallbacks.**
- **snake_case** for variables, functions, and filenames in server-side `.ts` files. Client files (`.js`) are kebab-case.
- **Temp variables for debugging.** If a method chain has more than 1 call, break it up with a temp variable. Return clean vars that can be inspected.
- **Read complete files before editing** if you haven't seen their current state this session.
- **Minimal changes** - change only what's asked; do not refactor unrelated code.
- **No comment removal** - don't remove or alter comments in code you're not touching.
- **Keep files small** - up to ~300 lines. Suggest a refactor if running over.
- **Use `Promise.all()` for independent async operations** - don't leave independent async I/O running sequentially.
- **When running server for any mode, tests and agent mode MUST use special ports, never 2338.** Tests use `TEST_PORT`, agent mode uses `AGENT_SERVER_PORT`. The developer runs server on 2338.
- **When correcting a bug or adding features**, do not modify code outside the feature's folder without guidance.
- **Cross-platform awareness** - developed on Windows, macOS, and Linux. Never redirect to `nul` on Windows (creates a protected file).
- **Don't use em-dashes or box-drawing characters.**
- **`<details>`** for expandable info (no JavaScript). **`<dialog>`** for confirmations (reuse codebase examples).
- **IGNORE `templates`/`template` folders** when checking TypeScript correctness - they contain codegen placeholders, not valid TS.
- **Template data** is accessed via `props.xxx` - never `data.xxx`.

- `lib/` is the upstream library - never edit it directly. Put project code in `src/lib/`.
- The shared `.ree` engine (`lib/template_engine.ts`, `lib/template/*`, `lib/template_engine.test.ts`) must match the canonical reepolee copy in logic. Run `bun run engine:check` to verify against a sibling checkout (`$REEPOLEE_DIR`, else `../reepolee`); it ignores comment and reettier-formatting differences and only fails on real logic drift.

---

## Commands

| Purpose | Command |
| --- | --- |
| Dev (fast) | `bun dev` |
| Dev (server only) | `bun run development` |
| Rendering for production | `bun run ssg` |
| Render a single page to stdout (fast feedback loop) | `bun run ssg:print-url /some/path` |
| CSS watch | `bun run css:watch` |
| CSS minified | `bun run css:build` |
| Format | `bun run format` (reettier) |
| Vendor check | `bun run vendor:check` |
| Test | `bun test` |
| Preview | `bun run preview` |

See `package.json` `scripts` for the full list.

**`bun run ssg:print-url <path>` is the fast way to check a `.ree`/`.md` page edit** - it renders just that one route and prints the HTML to stdout, instead of running a full `bun run ssg` generation and grepping `dist/`. In Git Bash on Windows, prefix with `MSYS_NO_PATHCONV=1` or Git Bash mangles the leading `/` into a Windows path (e.g. `MSYS_NO_PATHCONV=1 bun run ssg:print-url /docs/reeweb`). Add `--dev` to render with `is_dev: true` so dev-only template blocks (e.g. `{#if props.is_dev}`) show in the output.

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
