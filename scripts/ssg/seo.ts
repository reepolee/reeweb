/**
 * scripts/ssg/seo.ts
 *
 * SEO link construction: absolute URLs and hreflang alternate clusters.
 * The hreflang builder is parameterized by a `url_for_locale` callback so the
 * same logic serves hand-authored .ree pages, markdown pages, and numbered
 * pagination pages (which key off page number rather than canonical path).
 */

import { format_bcp47 } from "$root/src/lib/locale";

import type { HreflangLink } from "./types";

/** Absolute URL for a site-relative path: trailing slash normalized. */
export function abs_url(site_url: string, path: string): string {
	return site_url + path.replace(/\/+$/, "") + "/";
}

/**
 * Build the hreflang alternate cluster for a page.
 *
 * Emits one link per active, non-soft-launch locale plus an `x-default`
 * pointing at the default-locale variant. `url_for_locale(locale)` returns the
 * site-relative URL of the equivalent page in `locale`. Returns `[]` when no
 * `site_url` is configured (hreflang requires absolute URLs for Google).
 *
 * The emitted `locale` field is formatted to conventional BCP 47 casing
 * (format_bcp47: "en-us" -> "en-US") - `hreflang` is presentation output, even
 * though `locale` is stored lowercase internally. `x-default` is an IANA
 * reserved token, not a locale, and is left as-is.
 */
export function build_hreflang_links(opts: {
	site_url: string;
	locales: readonly string[];
	soft_launch_locales: readonly string[];
	default_locale: string;
	url_for_locale: (locale: string) => string;
}): HreflangLink[] {
	const { site_url, locales, soft_launch_locales, default_locale, url_for_locale } = opts;
	if (!site_url) return [];

	const links: HreflangLink[] = [];
	for (const alt_locale of locales.filter((l) => !soft_launch_locales.includes(l))) {
		links.push({ locale: format_bcp47(alt_locale), href: abs_url(site_url, url_for_locale(alt_locale)) });
	}
	links.push({ locale: "x-default", href: abs_url(site_url, url_for_locale(default_locale)) });
	return links;
}
