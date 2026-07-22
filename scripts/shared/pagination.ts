/**
 * scripts/shared/pagination.ts
 *
 * Small pure helpers shared by the SSG pagination phase
 * (scripts/ssg/render_pagination.ts) and the dev pagination handler
 * (scripts/dev/pagination.ts). These are the fiddly, drift-prone bits (page
 * URL math, per_page precedence); the two render flows themselves stay
 * separate (on-demand Response vs. batch file writes).
 *
 * The heavy lifting (`paginate`, `chunk_count`, `pagination_labels`,
 * `read_per_page_override`) lives in the upstream lib/pagination.ts.
 */

import { read_per_page_override } from "$lib/pagination";

/**
 * Build the URL function for pages of a route, given its already-localized
 * base URL and the config path segment:
 *   page 1   → `${base}/`
 *   page ≥ 2 → `${base}/${segment}/${n}/`  (or `${base}/${n}/` when no segment)
 */
export function make_paginated_url(localized_base: string, path_segment: string): (page: number) => string {
	const base = localized_base.replace(/\/+$/, "");
	return (page: number) => {
		if (page <= 1) return `${base}/`;
		return path_segment ? `${base}/${path_segment}/${page}/` : `${base}/${page}/`;
	};
}

/**
 * Resolve per-page count with the documented precedence:
 * literal `per-page="N"` in the index source > route config > global default.
 */
export function resolve_per_page(index_source: string, route_per_page: number | undefined, global_per_page: number): number {
	return read_per_page_override(index_source) ?? route_per_page ?? global_per_page;
}
