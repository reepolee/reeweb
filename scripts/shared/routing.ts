/**
 * scripts/shared/routing.ts
 *
 * Shared route resolution: canonical↔localized mapping plus output-path math.
 * Both the build (scripts/ssg/routing.ts) and the dev server (via SiteState)
 * adapt this shared core, keeping the two sides in lock-step. The same pattern
 * is used by the other modules in this directory (page_data, sidebar, etc.).
 */

import { locale_url_segment } from "$root/src/lib/locale";

/**
 * Resolves canonical paths to their localized variants, and back.
 */
export type RouteResolver = {
	/** Canonical path → localized path for `locale` (no locale prefix). */
	resolve_localized_path(canonical_path: string, locale: string): string;
	/** Canonical path → localized URL including the `/{locale}` prefix. */
	localized_url_for_locale(canonical_path: string, target_locale: string): string;
	/** Reverse: localized path → canonical path for `locale`, or null if unmapped. */
	resolve_canonical_from_localized(localized_path: string, locale: string): string | null;
};

/**
 * Append a trailing slash to an internal page URL so it matches directory-style
 * output (`<path>/index.html`). Leaves the root, existing trailing slashes,
 * and paths whose final segment has a file extension unchanged.
 */
export function with_trailing_slash(path: string): string {
	if (path === "" || path === "/" || path.endsWith("/")) return path;

	const last_segment = path.split("/").pop() ?? "";
	const has_extension = /\.[a-z0-9]+$/i.test(last_segment);
	if (has_extension) return path;

	return path + "/";
}

/**
 * Normalize root-relative page links in rendered HTML. Assets, external URLs,
 * anchors, query strings, and fragments retain their original meaning.
 */
export function normalize_internal_page_links(html: string): string {
	return html.replace(/\bhref=(["'])(\/[^"'?#]*)([^"']*)\1/g, (_match, quote: string, path: string, suffix: string) => {
		const normalized_path = with_trailing_slash(path);
		return `href=${quote}${normalized_path}${suffix}${quote}`;
	});
}

/**
 * Build a route resolver from the canonical→(locale→localized) route map.
 * Also builds the reverse map (localized→canonical) so both directions
 * are available without a separate pass.
 */
export function create_route_resolver(route_map: Map<string, Map<string, string>>, default_locale: string): RouteResolver {
	// Reverse map: locale → localized_path → canonical (for request resolution).
	const localized_to_canonical = new Map<string, Map<string, string>>();
	for (const [canonical, per_locale] of route_map) {
		for (const [locale, localized_path] of per_locale) {
			if (!localized_to_canonical.has(locale)) { localized_to_canonical.set(locale, new Map()); }
			localized_to_canonical.get(locale)!.set(localized_path, canonical);
		}
	}

	const resolve_localized_path = (canonical_path: string, locale: string): string => {
		return route_map.get(canonical_path)?.get(locale) ?? canonical_path;
	};

	return {
		resolve_localized_path,

		localized_url_for_locale(canonical_path: string, target_locale: string): string {
			const localized = resolve_localized_path(canonical_path, target_locale);
			const prefix = target_locale === default_locale ? "" : `/${locale_url_segment(target_locale)}`;
			return with_trailing_slash(prefix + localized);
		},

		resolve_canonical_from_localized(localized_path: string, locale: string): string | null {
			return localized_to_canonical.get(locale)?.get(localized_path) ?? null;
		},
	};
}

/** Where a page lands in dist/, plus its request URL - derived from its localized path. */
export type OutputTarget = {
	/** dist-relative output file, e.g. "o-nas/index.html" or "en-us/blog/index.html". */
	output_rel: string;
	/** Human label for --verbose logging. */
	verbose_label: string;
	/** Locale URL prefix: "" for default, "/{locale}" (lowercased) otherwise. */
	locale_url_prefix: string;
	/** Public request URL (trailing slash), e.g. "/o-nas/" or "/en-us/". */
	request_url: string;
	is_default: boolean;
};

/**
 * Compute the output location for a page. Mirrors the directory-style routing:
 *   "/"          → index.html            (default) / {locale}/index.html
 *   "/about"     → about/index.html       (default) / {locale}/about/index.html
 * The locale URL segment/output directory is always lowercased
 * (locale_url_segment); the canonical-case `locale` is used everywhere else.
 */
export function output_target(localized_path: string, locale: string, default_locale: string): OutputTarget {
	const is_default = locale === default_locale;
	const locale_segment = locale_url_segment(locale);
	const locale_url_prefix = is_default ? "" : `/${locale_segment}`;

	let output_rel: string;
	let verbose_label: string;
	if (localized_path === "/") {
		output_rel = is_default ? "index.html" : `${locale_segment}/index.html`;
		verbose_label = is_default ? "(root)/index.html" : `${locale_segment}/index.html`;
	} else {
		const localized_no_lead = localized_path.replace(
			/^\//,
			""
		);
		output_rel = is_default ? `${localized_no_lead}/index.html` : `${locale_segment}/${localized_no_lead}/index.html`;
		verbose_label = `${is_default ? "(root)" : locale_segment}/${localized_no_lead}/index.html`;
	}

	const request_url = localized_path === "/" ? locale_url_prefix + "/" : locale_url_prefix + localized_path + "/";

	return { output_rel, verbose_label, locale_url_prefix, request_url, is_default };
}
