/**
 * lib/draft_pages.ts
 *
 * Underscore-prefix draft convention.
 *
 * Any page whose path has a segment starting with "_" (e.g. `_wip/index.ree`,
 * `_draft.md`, `blog/_scratch.md`) is skipped from routing, the static build,
 * the sitemap, the RSS/JSON feeds, and the dev server. It is a glanceable
 * "not a route yet" marker in the file tree that - unlike the frontmatter
 * `draft:` flag - also works for `.ree` pages (the `.ree` render phase does not
 * consult content visibility).
 *
 * Scope notes:
 *   - This filters *collected page files* only (`.ree` / `.md`). Static assets
 *     copied by the asset walk are untouched, so Cloudflare's `_headers` and
 *     `_redirects` still ship.
 *   - The check keys on a segment's FIRST character being "_", so it never
 *     collides with the `NN_` ordering prefix (`02_installation.md`), which
 *     always starts with a digit.
 *
 * Distinct from `draft: true` frontmatter: a `draft:` page is still rendered and
 * reachable by its URL (just noindex + out of every aggregation) - a soft launch
 * with a stable URL. An `_`-prefixed page is not built at all: invisible even by
 * direct URL. Use `_` for true work-in-progress; use `draft:` for a reviewable
 * preview link.
 */

/** Whether a collected page path is an underscore-prefixed draft (any segment). */
export function is_underscore_draft(rel_path: string): boolean {
	const normalized = rel_path.replace(/\\/g, "/");
	return normalized.split("/").some((segment) => segment.startsWith("_"));
}

/** Drop underscore-prefixed draft pages from a collected page-file list. */
export function without_draft_pages(page_files: string[]): string[] {
	return page_files.filter((rel_path) => !is_underscore_draft(rel_path));
}
