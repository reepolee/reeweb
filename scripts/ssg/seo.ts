/**
 * scripts/ssg/seo.ts
 *
 * SEO link construction: absolute URLs and hreflang alternate clusters.
 * The hreflang builder is parameterized by a `url_for_lang` callback so the
 * same logic serves hand-authored .ree pages, markdown pages, and numbered
 * pagination pages (which key off page number rather than canonical path).
 */

import type { HreflangLink } from "./types";

/** Absolute URL for a site-relative path: trailing slash normalized. */
export function abs_url(site_url: string, path: string): string {
	return site_url + path.replace(/\/+$/, "") + "/";
}

/**
 * Build the hreflang alternate cluster for a page.
 *
 * Emits one link per active, non-soft-launch language plus an `x-default`
 * pointing at the default-language variant. `url_for_lang(lang)` returns the
 * site-relative URL of the equivalent page in `lang`. Returns `[]` when no
 * `site_url` is configured (hreflang requires absolute URLs for Google).
 */
export function build_hreflang_links(opts: {
	site_url: string;
	languages: readonly string[];
	soft_launch_languages: readonly string[];
	default_language: string;
	url_for_lang: (lang: string) => string;
}): HreflangLink[] {
	const { site_url, languages, soft_launch_languages, default_language, url_for_lang } = opts;
	if (!site_url) return [];

	const links: HreflangLink[] = [];
	for (const alt_lang of languages.filter((l) => !soft_launch_languages.includes(l))) {
		links.push({ lang: alt_lang, href: abs_url(site_url, url_for_lang(alt_lang)) });
	}
	links.push({ lang: "x-default", href: abs_url(site_url, url_for_lang(default_language)) });
	return links;
}
