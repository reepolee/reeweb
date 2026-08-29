/**
 * scripts/dev/page_data.ts
 *
 * Dev-side adapter over the shared render-data core (scripts/shared/page_data.ts).
 * Dev data differs from the build's: `is_dev: true`, no real site/canonical
 * URLs, and no hreflang cluster (dev is never indexed). The object shape and
 * helper wiring live in the shared module.
 */

import {
	active_locales,
	default_locale,
	locale_names,
	locales,
	soft_launch_locales,
} from "$config/supported_locales";
import { project_hooks } from "$root/src/lib/project_hooks";

import { build_page_data as build_page_data_core } from "../shared/page_data";
import type { SiteState } from "./site_state";

export type DevPageFields = {
	locale: string;
	locale_url_prefix: string;
	request_url: string;
	canonical_path: string;
	site_name: string;
};

/** Assemble the full template render data for a dev-server page. */
export function build_dev_page_data(state: SiteState, fields: DevPageFields, extras: Record<string, any>): Record<string, any> {
	const { locale } = fields;

	return build_page_data_core({
		locale,
		locale_url_prefix: fields.locale_url_prefix,
		request_url: fields.request_url,
		canonical_path: fields.canonical_path,
		hreflang_links: [],
		site_name: fields.site_name,
		is_dev: true,
		base_url: "/",
		site_url: "",
		year: new Date().getFullYear(),
		active_locales,
		soft_launch_locales,
		locale_names,
		locale_self_names: state.locale_self_names,
		default_locale,
		locales,
		locale_urls: state.locale_urls,
		localized_url: (path, target) => state.localized_url_for_locale(path, target),
		helper_functions: project_hooks.helper_functions ?? {},
	}, extras);
}
