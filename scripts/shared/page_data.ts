/**
 * scripts/shared/page_data.ts
 *
 * Shared render-data assembly for SSG (scripts/ssg/page_data.ts) and dev
 * (scripts/dev/page_data.ts). Owns the render-data object shape, the
 * project-hook spread, and the localization-helper wiring - the parts that
 * must stay in lock-step between the two. The ssg/dev wrappers supply the
 * values that legitimately differ (SEO/canonical URLs, is_dev, config source).
 */

import pkg from "$root/package.json";
import { create_template_helpers } from "$lib/template_helpers";
import { project_hooks } from "$root/src/lib/project_hooks";
import { locale_language } from "$root/src/lib/locale";

/**
 * Cache-busting token for the `?v=` query param on the CSS/JS tags in the
 * layouts, derived the same way reepolee does it (lib/bootstrap.ts): the package
 * version for a build, the tail of the current epoch milliseconds in dev.
 *
 * Dev cannot use the package version - `bun dev` recompiles style.min.css on
 * every edit while the version stays put, so the browser keeps serving the stale
 * stylesheet. Computed once per process, so every page in a dev session shares
 * one token and a restart mints a new one.
 */
const dev_version = Date.now().toString().slice(-4);

/** Fully-resolved base for a page's render data; wrappers compute these values. */
export type PageDataBase = {
	locale: string;
	locale_url_prefix: string;
	request_url: string;
	canonical_path: string;
	/** Absolute canonical URL (SSG only; omitted in dev, which is never indexed). */
	canonical_url?: string;
	hreflang_links: { locale: string; href: string; }[];
	site_name: string;
	is_dev: boolean;
	base_url: string;
	site_url: string;
	year: number;
	active_locales: readonly string[];
	soft_launch_locales: readonly string[];
	locale_names: Record<string, string>;
	locale_self_names: Record<string, string>;
	default_locale: string;
	locales: readonly string[];
	locale_urls: Record<string, string>;
	/** Resolve a canonical path to a localized URL for a locale. */
	localized_url: (path: string, locale: string) => string;
	helper_functions: Record<string, any>;
};

/**
 * Assemble the full template render data: the shared base, the project-hook
 * global fields (seam 2), the caller's `extras` (translations, body, records,
 * …), and the localization helpers bound to `locale`. Extras come last so a
 * page can override base defaults via frontmatter/translations.
 */
export function build_page_data(base: PageDataBase, extras: Record<string, any>): Record<string, any> {
	const { locale } = base;

	const data: Record<string, any> = {
		locale,
		// The shared template engine (lib/template_engine.ts) resolves localized
		// template variants via props.lang - keep both fields on the same value.
		lang: locale,
		// Short BCP 47 language subtag ("sl-si" -> "sl") for the <html lang="...">
		// attribute - the one place a short code is still correct HTML.
		html_lang: locale_language(locale),
		locale_url_prefix: base.locale_url_prefix,
		active_locales: base.active_locales.filter((l) => !base.soft_launch_locales.includes(
			l
		)),
		locale_names: base.locale_names,
		locale_self_names: base.locale_self_names,
		noindex: base.soft_launch_locales.includes(locale),
		default_locale: base.default_locale,
		base_url: base.base_url,
		site_url: base.site_url,
		hreflang_links: base.hreflang_links,
		site_name: base.site_name,
		year: base.year,
		is_dev: base.is_dev,
		version: base.is_dev ? dev_version : pkg.version,
		rendered_at: new Date().toISOString(),
		request_url: base.request_url,
		canonical_path: base.canonical_path,
		localized_url: base.localized_url,
		...(base.canonical_url !== undefined ? { canonical_url: base.canonical_url } : {}),
		locale_urls: base.locale_urls,
		// Project-contributed global fields (seam 2). Before extras so a page can
		// still override them via frontmatter/translations.
		...project_hooks.page_data_extras?.({
			is_dev: base.is_dev,
			locales: base.locales,
			default_locale: base.default_locale,
		}),
		// Caller extras last so they win over base defaults; translations win over template data.
		...extras,
	};

	data.helpers = create_template_helpers(data, base.helper_functions);

	return data;
}
