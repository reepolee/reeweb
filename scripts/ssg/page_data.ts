/**
 * scripts/ssg/page_data.ts
 *
 * Build-side adapter over the shared render-data core (scripts/shared/page_data.ts).
 * Supplies the real SEO/canonical URLs, build constants, and config from the
 * BuildContext. The object shape and helper wiring live in the shared module.
 */

import { project_hooks } from "$root/src/lib/project_hooks";

import { build_page_data as build_page_data_core } from "../shared/page_data";
import type { BuildContext, HreflangLink } from "./types";

/** Page-specific fields the render phases compute per language. */
export type PageDataFields = {
	lang: string;
	lang_url_prefix: string;
	locale: string;
	request_url: string;
	canonical_path: string;
	canonical_url: string;
	hreflang_links: HreflangLink[];
	site_name: string;
};

/** Assemble the full template render data for a build page. */
export function build_page_data(ctx: BuildContext, fields: PageDataFields, extras: Record<string, any>): Record<string, any> {
	return build_page_data_core({
		lang: fields.lang,
		lang_url_prefix: fields.lang_url_prefix,
		locale: fields.locale,
		request_url: fields.request_url,
		canonical_path: fields.canonical_path,
		canonical_url: fields.canonical_url,
		hreflang_links: fields.hreflang_links,
		site_name: fields.site_name,
		is_dev: ctx.options.dev,
		base_url: ctx.options.base_url,
		site_url: ctx.options.site_url,
		year: ctx.year,
		active_languages: ctx.active_languages,
		soft_launch_languages: ctx.soft_launch_languages,
		language_names: ctx.language_names,
		language_self_names: ctx.language_self_names,
		default_language: ctx.default_language,
		languages: ctx.languages,
		language_urls: ctx.language_urls,
		localized_url: (path, lang) => ctx.route_resolver.localized_url_for_lang(path, lang),
		helper_functions: project_hooks.helper_functions ?? {},
	}, extras);
}
