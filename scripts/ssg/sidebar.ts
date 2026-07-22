/**
 * scripts/ssg/sidebar.ts
 *
 * Build-side adapter over the shared sidebar core (scripts/shared/sidebar.ts).
 * Supplies config + the route resolver from the BuildContext; the algorithm
 * lives in the shared module.
 */

import {
	build_sidebar_map as build_sidebar_map_core,
	sidebar_links_for as sidebar_links_for_core,
	type SidebarLink,
	type SidebarMap,
} from "../shared/sidebar";
import type { BuildContext } from "./types";

/** Build the sidebar map for all folders whose index.md sets `has_sidebar: true`. */
export function build_sidebar_map(md_files: string[], ctx: BuildContext): Promise<SidebarMap> {
	return build_sidebar_map_core(md_files, {
		languages: ctx.languages,
		default_language: ctx.default_language,
		public_dir: ctx.options.public_dir,
		log: true,
	});
}

/** Resolve the localized sidebar links for a page (or undefined). */
export function sidebar_links_for(canonical_path: string, lang: string, sidebar_map: SidebarMap, ctx: BuildContext): SidebarLink[] | undefined {
	return sidebar_links_for_core(canonical_path, lang, sidebar_map, (cp, l) => ctx.route_resolver.localized_url_for_lang(
		cp,
		l
	));
}
