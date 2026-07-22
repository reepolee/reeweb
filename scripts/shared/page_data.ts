/**
 * scripts/shared/page_data.ts
 *
 * Shared render-data assembly for SSG (scripts/ssg/page_data.ts) and dev
 * (scripts/dev/page_data.ts). Owns the render-data object shape, the
 * project-hook spread, and the localization-helper wiring - the parts that
 * must stay in lock-step between the two. The ssg/dev wrappers supply the
 * values that legitimately differ (SEO/canonical URLs, is_dev, config source).
 */

import { create_template_helpers } from "$lib/template_helpers";
import { project_hooks } from "$root/src/lib/project_hooks";

/** Fully-resolved base for a page's render data; wrappers compute these values. */
export type PageDataBase = {
	lang: string;
	lang_url_prefix: string;
	locale: string;
	request_url: string;
	canonical_path: string;
	/** Absolute canonical URL (SSG only; omitted in dev, which is never indexed). */
	canonical_url?: string;
	hreflang_links: { lang: string; href: string; }[];
	site_name: string;
	is_dev: boolean;
	base_url: string;
	site_url: string;
	year: number;
	active_languages: readonly string[];
	soft_launch_languages: readonly string[];
	language_names: Record<string, string>;
	language_self_names: Record<string, string>;
	default_language: string;
	languages: readonly string[];
	language_urls: Record<string, string>;
	/** Resolve a canonical path to a localized URL for a language. */
	localized_url: (path: string, lang: string) => string;
	helper_functions: Record<string, any>;
};

/**
 * Assemble the full template render data: the shared base, the project-hook
 * global fields (seam 2), the caller's `extras` (translations, body, records,
 * …), and the localization helpers bound to `lang`. Extras come last so a page
 * can override base defaults via frontmatter/translations.
 */
export function build_page_data(base: PageDataBase, extras: Record<string, any>): Record<string, any> {
	const { lang } = base;

	const data: Record<string, any> = {
		lang,
		lang_url_prefix: base.lang_url_prefix,
		locale: base.locale,
		active_languages: base.active_languages.filter((l) => !base.soft_launch_languages.includes(
			l
		)),
		language_names: base.language_names,
		language_self_names: base.language_self_names,
		noindex: base.soft_launch_languages.includes(lang),
		default_language: base.default_language,
		base_url: base.base_url,
		site_url: base.site_url,
		hreflang_links: base.hreflang_links,
		site_name: base.site_name,
		year: base.year,
		is_dev: base.is_dev,
		rendered_at: new Date().toISOString(),
		request_url: base.request_url,
		canonical_path: base.canonical_path,
		...(base.canonical_url !== undefined ? { canonical_url: base.canonical_url } : {}),
		language_urls: base.language_urls,
		// Project-contributed global fields (seam 2). Before extras so a page can
		// still override them via frontmatter/translations.
		...project_hooks.page_data_extras?.({
			is_dev: base.is_dev,
			languages: base.languages,
			default_language: base.default_language,
		}),
		// Caller extras last so they win over base defaults; translations win over template data.
		...extras,
	};

	data.helpers = create_template_helpers(data, base.helper_functions);
	data.helpers.localized_path = (path: string) => base.localized_url(path, lang);
	data.helpers.localized_path_for_lang = (target_lang: string, path: string) => base.localized_url(
		path,
		target_lang
	);

	return data;
}
