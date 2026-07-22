/**
 * scripts/dev/sidebar.ts
 *
 * Dev-side adapter over the shared sidebar core (scripts/shared/sidebar.ts).
 * Supplies config + the localized-URL resolver from the live SiteState; the
 * algorithm lives in the shared module.
 */

import { default_language, languages } from "$config/supported_languages";

import {
	build_sidebar_map as build_sidebar_map_core,
	sidebar_links_for as sidebar_links_for_core,
	type SidebarLink,
	type SidebarMap,
} from "../shared/sidebar";
import type { SiteState } from "./site_state";

export type { SidebarEntry, SidebarLink, SidebarMap } from "../shared/sidebar";

/** Build folder path → (language → ordered link entries) for sidebar folders. */
export function build_dev_sidebar_map(state: SiteState): Promise<SidebarMap> {
	return build_sidebar_map_core(state.md_files, {
		languages,
		default_language,
		public_dir: state.public_dir,
	});
}

/** Localized sidebar links for a page, or `undefined` if not in a sidebar folder. */
export function sidebar_links_for(canonical_path: string, lang: string, sidebar_map: SidebarMap, state: SiteState): SidebarLink[] | undefined {
	return sidebar_links_for_core(canonical_path, lang, sidebar_map, (cp, l) => state.localized_url_for_lang(
		cp,
		l
	));
}
