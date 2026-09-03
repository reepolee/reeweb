/**
 * config/search.ts
 *
 * Configuration for the static search index (`bun ssg:search`, emitted by
 * scripts/generate_search_index.ts and consumed by src/public/js/site-search.js).
 *
 * The default indexes the whole site into `dist/search-index.json`. Split the
 * site into several indexes by adding sources: each one gets its own file under
 * its prefix, and the client fetches the current section first and the rest in
 * the background, grouping results under `brand`.
 *
 * Rules:
 *  - `prefix` is a URL path ("" = the whole site) and decides where the index
 *    is written: `dist/<prefix>/search-index.json`
 *  - `root` overrides the source folder under `src/public/`; it defaults to
 *    `prefix` without its leading slash
 *  - `brand` labels the group in the results list; "" renders no header, which
 *    is what a single-source site wants
 *  - `strip` removes exact strings from extracted text, for chrome that every
 *    page repeats (a status banner, a footer) and that would otherwise match
 *    every query
 */

export type SearchSource = {
	/** URL prefix for this index. "" indexes the whole site. */
	prefix: string;
	/** Group heading above this source's results. "" renders no heading. */
	brand: string;
	/** Folder under `src/public/`. Defaults to `prefix` without its slash. */
	root?: string;
};

export type SearchConfig = {
	/** When false, `bun ssg:search` exits without writing anything. */
	enabled: boolean;
	/** One emitted index per entry. */
	sources: SearchSource[];
	/** Exact strings removed from indexed text (repeated page chrome). */
	strip: string[];
};

export const search: SearchConfig = {
	enabled: true,
	sources: [{ prefix: "", brand: "" }],
	strip: [],
};
