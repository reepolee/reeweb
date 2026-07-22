/**
 * scripts/dev/pagination.ts
 *
 * Dev-server pagination - mirrors the pagination phase in scripts/ssg/. Maps
 * a request to a registered route + page number, then renders that route's
 * index.ree with the page's records and a PaginationData view-model.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { pagination as pagination_config, type PaginationRoute } from "$config/pagination";
import { default_language } from "$config/supported_languages";
import { resolve_route_records } from "$lib/collect_records";
import { chunk_count, pagination_labels, paginate } from "$lib/pagination";
import { project_hooks } from "$root/src/lib/project_hooks";
import { path_to_namespace } from "$lib/static_site";

import { make_paginated_url, resolve_per_page } from "../shared/pagination";
import { normalize_internal_page_links } from "../shared/routing";
import type { DevContext } from "./context";
import { inject_live_reload } from "./live_reload";
import { build_dev_page_data } from "./page_data";
import { respond_error, respond_html, respond_not_found } from "./responses";
import type { SiteState } from "./site_state";

export type PaginationMatch = { route: PaginationRoute; page: number; canonical_base: string; };

/**
 * Match a language-stripped, slash-normalized path to a pagination route+page.
 *   /blog          → page 1
 *   /blog/page/2   → page 2   (a non-numeric tail won't match - that's a slug)
 */
export function match_pagination(path: string, lang: string, state: SiteState): PaginationMatch | null {
	if (!pagination_config.enabled) return null;

	const seg = pagination_config.path_segment;

	for (const route of pagination_config.routes) {
		const route_dir = route.route.replace(/^\/+|\/+$/g, "");
		const canonical_base = "/" + route_dir;
		const localized_base = state.resolve_localized_path(canonical_base, lang);

		if (path === localized_base) return { route, page: 1, canonical_base };

		const prefix = seg ? `${localized_base}/${seg}/` : `${localized_base}/`;
		if (path.startsWith(prefix)) {
			const rest = path.slice(prefix.length);
			if (/^\d+$/.test(rest)) return { route, page: parseInt(rest, 10), canonical_base };
		}
	}

	return null;
}

/** Render a matched pagination page. */
export async function render_pagination(ctx: DevContext, match: PaginationMatch, lang: string): Promise<Response> {
	const { engine, state } = ctx;
	const { route, page, canonical_base } = match;
	const route_dir = route.route.replace(/^\/+|\/+$/g, "");
	const index_rel = `${route_dir}/index.ree`;
	const index_full = join(state.public_dir, index_rel);

	if (!existsSync(index_full)) return respond_not_found();

	// per_page precedence: literal `per-page="N"` in source > route config > global.
	const per_page = resolve_per_page(
		readFileSync(index_full, "utf-8"),
		route.per_page,
		pagination_config.per_page
	);

	const records = await resolve_route_records(
		state.public_dir,
		route,
		lang,
		state.all_page_files,
		new Date(),
		project_hooks.content_visibility
	);
	const last_page = chunk_count(records.length, per_page);
	if (page < 1 || page > last_page) return respond_not_found();

	const page_url = make_paginated_url(
		state.localized_url_for_lang(canonical_base, lang),
		pagination_config.path_segment
	);

	const merged = state.merge_strings(lang, path_to_namespace(index_rel));
	const global_strings = state.translations[lang]?.routes ?? {};
	const labels = pagination_labels((global_strings as any).ui?.pagination);

	const pagination_data = paginate(records.length, page, per_page, {
		show_when_single_page: pagination_config.show_when_single_page,
		always_show_prev_next: pagination_config.always_show_prev_next,
		labels,
	}, page_url);

	const lang_url_prefix = lang === default_language ? "" : `/${lang}`;

	const data = build_dev_page_data(state, {
		lang,
		lang_url_prefix,
		request_url: page_url(page),
		canonical_path: canonical_base,
		site_name: String(merged.site_name ?? ""),
	}, {
		records: records.slice((page - 1) * per_page, page * per_page),
		pagination: pagination_data,
		pagination_variant: pagination_config.variant,
		translations: merged,
	});

	try {
		const rendered_html = await engine.render(`${route_dir}/index`, data);
		const html = normalize_internal_page_links(rendered_html);
		return respond_html(await inject_live_reload(html));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`    ✗ ${lang}/${index_rel} page ${page}: ${msg}`);
		return respond_error(msg);
	}
}
