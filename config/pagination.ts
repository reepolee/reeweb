/**
 * config/pagination.ts
 *
 * Pagination configuration - the single source of truth for which routes get
 * statically-built, numbered pages (e.g. /blog/, /blog/page/2/, /blog/page/3/)
 * and how the shipped <pagination> / <simple-pagination> components behave.
 *
 * Consumed by:
 *   - scripts/ssg.ts - builds one HTML page per page-number, per language.
 *
 * Pagination is decoupled from where the records come from. The default path
 * collects markdown records from the route's folder (lib/collect_records.ts).
 * A route can instead supply records from anywhere (external API, DB, a static
 * array) by exporting `load_records(lang)` from the route's `index.ts` - see
 * the `source` field below. The components are a pure view layer: they consume
 * the resulting PaginationData object and know nothing about the data source.
 */

export type PaginationRoute = {
	/**
	 * Base route to paginate - also the output location and the directory that
	 * holds the `index.ree` rendered for each page.
	 *   "blog" → /blog/, /blog/page/2/, /en/blog/page/2/
	 */
	route: string;
	/**
	 * Where the records come from:
	 *   "markdown" → collect_records() over <route>/*.md (the default).
	 *   "loader"   → the route's index.ts must export `load_records(lang)`
	 *                returning the full records array (external API, DB, etc.).
	 * Omit to auto-detect: the loader is used when `load_records` is exported,
	 * otherwise the markdown collector.
	 */
	source?: "markdown" | "loader";
	/**
	 * Per-route override of the global `per_page`. A literal `per-page="N"` on the
	 * pagination component in the route's index.ree takes precedence over this
	 * (it's read from the template source at build time).
	 */
	per_page?: number;
	/** Sort order for the default markdown collector. Default: "date_desc". */
	sort?: "date_desc" | "date_asc" | "filename";
};

export type PaginationConfig = {
	/** Global master switch. false → no pagination pages are built at all. */
	enabled: boolean;
	/** Default items per page (routes may override via `per_page`). */
	per_page: number;
	/**
	 * URL segment placed before the page number.
	 *   ""     → /blog/2/        (default - language-neutral, nothing to localize)
	 *   "page" → /blog/page/2/   (Laravel-style; the word is NOT localized)
	 * With an empty segment, a numeric record slug (e.g. a post literally named
	 * "2") would collide with a page URL - avoid purely-numeric slugs in
	 * paginated routes.
	 */
	path_segment: string;

	// ── Behaviour toggles ────────────────────────────────────────────
	/**
	 * Render the pagination element even when every result fits on page 1.
	 * Default false - matches Laravel's `hasPages()` (hide when only one page).
	 */
	show_when_single_page: boolean;
	/**
	 * Always render Previous/Next, just disabled on the first/last page.
	 * Default true.
	 */
	always_show_prev_next: boolean;

	/**
	 * NOTE: the page-number window (how many links to show around the current
	 * page) is NOT a global value - it is set per-component via the
	 * `on-each-side` attribute (omitted = show all page numbers). Intentionally
	 * left out of this object.
	 */

	/** Which shipped component the default index template uses: "full" | "simple". */
	variant: "full" | "simple";

	/** Registered routes (markdown folders and/or loader-backed routes). */
	routes: PaginationRoute[];
};

export const pagination: PaginationConfig = {
	enabled: true,
	per_page: 10,
	path_segment: "", // /blog/2/ - no untranslated "page" word in the URL
	show_when_single_page: false,
	always_show_prev_next: true,
	// Alternative is simple
	variant: "full",
	// Default reepolee install: paginate the markdown blog.
	routes: [{ route: "blog" }],
};
