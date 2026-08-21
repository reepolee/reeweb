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

/** Page-specific fields the render phases compute per locale. */
export type PageDataFields = {
	locale: string;
	locale_url_prefix: string;
	request_url: string;
	canonical_path: string;
	canonical_url: string;
	hreflang_links: HreflangLink[];
	site_name: string;
};

/** Assemble the full template render data for a build page. */
export function build_page_data(ctx: BuildContext, fields: PageDataFields, extras: Record<string, any>): Record<string, any> {
	return build_page_data_core({
		locale: fields.locale,
		locale_url_prefix: fields.locale_url_prefix,
		request_url: fields.request_url,
		canonical_path: fields.canonical_path,
		canonical_url: fields.canonical_url,
		hreflang_links: fields.hreflang_links,
		site_name: fields.site_name,
		is_dev: ctx.options.dev,
		base_url: ctx.options.base_url,
		site_url: ctx.options.site_url,
		year: ctx.year,
		active_locales: ctx.active_locales,
		soft_launch_locales: ctx.soft_launch_locales,
		locale_names: ctx.locale_names,
		locale_self_names: ctx.locale_self_names,
		default_locale: ctx.default_locale,
		locales: ctx.locales,
		locale_urls: ctx.locale_urls,
		localized_url: (path, locale) => ctx.route_resolver.localized_url_for_locale(path, locale),
		helper_functions: project_hooks.helper_functions ?? {},
	}, extras);
}
