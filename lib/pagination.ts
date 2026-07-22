/**
 * lib/pagination.ts
 *
 * Pure, source-agnostic paginator. Given a record COUNT (not the records
 * themselves), a page number, a page size, and a `url_for(page)` callback, it
 * produces the `PaginationData` view-model the shipped <pagination> /
 * <simple-pagination> components consume.
 *
 * It has no knowledge of where the records came from (markdown, an external
 * API, a static array) or of their shape - only how many there are and how to
 * build a URL for a given page. The same function paginates everything.
 *
 * Pure functions only - no I/O.
 */

export type PageLink = { number: number; url: string; active: boolean; };

/** An entry in a windowed page list: a page link or an ellipsis gap marker. */
export type WindowItem = PageLink | { ellipsis: true; };

/**
 * Localized UI strings the component needs. Components are scope-isolated and
 * cannot read the outer `props.ui`, so every word is carried in the data object.
 */
export type PaginationLabels = {
	previous: string;
	next: string;
	/** aria-label for the <nav>. */
	aria: string;
	// "Showing {from} {to} {to_n} ({total} {results} {total_label})" summary words:
	showing: string;
	to: string;
	results: string;
	total_label: string;
};

export type PaginationOptions = {
	/** Render the element even when everything fits on one page. */
	show_when_single_page: boolean;
	/** Always render Prev/Next, disabled at the ends. */
	always_show_prev_next: boolean;
	/** Localized labels. */
	labels: PaginationLabels;
};

export type PaginationData = {
	current_page: number;
	last_page: number;
	per_page: number;
	total: number;
	/** 1-based index of the first item on the current page (0 when empty). */
	from: number;
	/** 1-based index of the last item on the current page (0 when empty). */
	to: number;
	/** Whether there is more than one page. */
	has_pages: boolean;
	on_first_page: boolean;
	on_last_page: boolean;
	/** URL of the previous/next page, or null when unavailable. */
	prev_url: string | null;
	next_url: string | null;
	/** Every page (1..last_page) with its URL - the component slices/windows this. */
	pages: PageLink[];
	// render flags + labels carried for the (scope-isolated) component:
	show_when_single_page: boolean;
	always_show_prev_next: boolean;
	labels: PaginationLabels;
};

/**
 * Build the localized label set from a translation block (the `ui.pagination`
 * object), falling back to English. Shared by the build and dev render paths.
 */
export function pagination_labels(ui_pagination: any): PaginationLabels {
	const s = ui_pagination ?? {};
	return {
		previous: s.previous ?? "Previous",
		next: s.next ?? "Next",
		aria: s.label ?? "Pagination",
		showing: s.showing ?? "Showing",
		to: s.to ?? "to",
		results: s.results ?? "results",
		total_label: s.total_label ?? "total",
	};
}

/**
 * Read a `per-page="N"` override off the pagination component in a route's
 * `index.ree` **source**. Because page count and record slicing are decided at
 * build time (before the template renders), this attribute is resolved by
 * scanning the template text, not at render time - so the value must be a
 * literal positive integer (template expressions are ignored). Returns null when
 * absent, letting the caller fall back to route/global `per_page`.
 */
export function read_per_page_override(template_source: string): number | null {
	const match = template_source.match(
		/<(?:full|simple)-pagination\b[^>]*?\bper-page\s*=\s*["'](\d+)["']/
	);
	if (!match?.[1]) return null;
	const n = parseInt(match[1], 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Number of pages needed to hold `total` items at `per_page` each (min 1). */
export function chunk_count(total: number, per_page: number): number {
	if (per_page < 1) return 1;
	if (total <= 0) return 1;
	return Math.ceil(total / per_page);
}

/**
 * Build the pagination view-model for one page.
 *
 * @param total    Total number of records across all pages.
 * @param page     Requested page number (clamped to 1..last_page).
 * @param per_page Items per page.
 * @param opts     Behaviour flags + localized labels.
 * @param url_for  Maps a page number to its URL.
 */
export function paginate(
	total: number,
	page: number,
	per_page: number,
	opts: PaginationOptions,
	url_for: (page_number: number) => string,
): PaginationData {
	const last_page = chunk_count(total, per_page);
	const current_page = Math.min(Math.max(page, 1), last_page);

	const from = total === 0 ? 0 : (current_page - 1) * per_page + 1;
	const to = Math.min(current_page * per_page, total);

	const on_first_page = current_page <= 1;
	const on_last_page = current_page >= last_page;

	const pages: PageLink[] = [];
	for (let i = 1; i <= last_page; i++) {
		pages.push({ number: i, url: url_for(i), active: i === current_page });
	}

	return {
		current_page,
		last_page,
		per_page,
		total,
		from,
		to,
		has_pages: last_page > 1,
		on_first_page,
		on_last_page,
		prev_url: on_first_page ? null : url_for(current_page - 1),
		next_url: on_last_page ? null : url_for(current_page + 1),
		pages,
		show_when_single_page: opts.show_when_single_page,
		always_show_prev_next: opts.always_show_prev_next,
		labels: opts.labels,
	};
}

/**
 * Reduce the full page list to a window of ±`on_each_side` links around the
 * current page, inserting an ellipsis where a run of pages is skipped. Always
 * keeps the first and last page.
 *
 * `on_each_side == null` → return every page (no windowing). When a gap hides a
 * single page, that page is shown instead of a one-page ellipsis.
 *
 * NOTE: this implementation is mirrored verbatim inside
 * `src/components/pagination.ree` (the .ree engine has no module imports). Keep
 * the two in sync; `lib/pagination.test.ts` is the source of truth for behaviour.
 */
export function build_window(pages: PageLink[], current: number, last: number, on_each_side: number | null): WindowItem[] {
	if (on_each_side == null) return pages.slice();

	const wanted = new Set<number>([1, last]);
	for (let i = current - on_each_side; i <= current + on_each_side; i++) {
		if (i >= 1 && i <= last) wanted.add(i);
	}

	const sorted = [...wanted].sort((a, b) => a - b);
	const items: WindowItem[] = [];
	let prev = 0;

	for (const p of sorted) {
		const gap = p - prev;
		if (gap === 2) {
			// Only one page hidden - show it rather than an ellipsis.
			items.push(pages[prev]); // pages[prev] is page number prev+1 (1-indexed)
		} else if (gap > 2) {
			items.push({ ellipsis: true });
		}
		items.push(pages[p - 1]);
		prev = p;
	}

	return items;
}
