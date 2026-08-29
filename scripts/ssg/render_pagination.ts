/**
 * scripts/ssg/render_pagination.ts
 *
 * Render phase for paginated routes. For each enabled route we resolve its
 * records (markdown by default, or an external loader), chunk them, and render
 * the route's index.ree once per page-number, per locale:
 *   page 1   → /<route>/            (the normal index location)
 *   page ≥ 2 → /<route>/<segment>/<n>/
 *
 * Returns the usual tally plus the formula/actual page counts the build
 * summary needs to correct its flat estimate.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { pagination as pagination_config, type PaginationRoute } from "$config/pagination";
import { resolve_route_records } from "$lib/collect_records";
import { chunk_count, pagination_labels, paginate } from "$lib/pagination";
import { path_to_namespace, template_to_canonical } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";
import { locale_url_segment } from "$root/src/lib/locale";

import { make_paginated_url, resolve_per_page } from "../shared/pagination";
import { normalize_internal_page_links } from "../shared/routing";
import { build_page_data } from "./page_data";
import { abs_url, build_hreflang_links } from "./seo";
import { merge_route_strings } from "./translation_merge";
import type { BuildContext, RenderTally } from "./types";
import { write_page } from "./write_page";

export type PaginationTally = RenderTally & {
	/** Renders the flat summary formula already assumes (1 per route per locale). */
	formula_pagination_count: number;
	/** Renders this phase actually produced. */
	actual_pagination_count: number;
};

/**
 * Render a single page-number of a single paginated route, for one locale,
 * and write it to dist/. Shared by the batch phase (`render_paginated_routes`)
 * and the single-page print-url path, so both stay byte-for-byte identical.
 */
export async function render_pagination_page(ctx: BuildContext, route: PaginationRoute, locale: string, page: number, all_page_files: string[]): Promise<{ output_rel: string; request_url: string; last_page: number; }> {
	const { engine, options, locales, default_locale, route_resolver } = ctx;
	const { localized_url_for_locale } = route_resolver;
	const public_dir = options.public_dir;

	const route_dir = route.route.replace(/^\/+|\/+$/g, "");
	const index_rel = `${route_dir}/index.ree`;
	const template_name = `${route_dir}/index`;
	const index_full = join(public_dir, index_rel);

	if (!existsSync(index_full)) { throw new Error(`Pagination route "${route_dir}" has no ${index_rel}`); }

	const canonical_path = template_to_canonical(index_rel); // e.g. "/blog"
	const namespace = path_to_namespace(index_rel); // e.g. "blog"
	const seg = pagination_config.path_segment;

	// per_page precedence: literal `per-page="N"` in source > route config > global default.
	const index_source = readFileSync(index_full, "utf-8");
	const per_page = resolve_per_page(index_source, route.per_page, pagination_config.per_page);

	const records = await resolve_route_records(
		public_dir,
		route,
		locale,
		all_page_files,
		new Date(),
		project_hooks.content_visibility
	);
	const last_page = chunk_count(records.length, per_page);

	const is_default = locale === default_locale;
	const locale_url_prefix = is_default ? "" : `/${locale_url_segment(locale)}`;

	// href for page `n` of this route, in `target_locale`.
	// `seg` empty → /blog/2/ ; otherwise → /blog/<seg>/2/.
	const page_url_for_locale = (target_locale: string, n: number) => make_paginated_url(localized_url_for_locale(
		canonical_path,
		target_locale
	), seg)(n);
	const page_url = make_paginated_url(localized_url_for_locale(canonical_path, locale), seg);

	const merged = merge_route_strings(ctx.translations, locale, namespace);

	// Labels live under ui.pagination to avoid colliding with the injected
	// `pagination` (PaginationData) prop when `...merged` is spread below.
	const global_strings = ctx.translations[locale]?.routes ?? {};
	const labels = pagination_labels((global_strings as any).ui?.pagination);

	const request_url = page_url(page);
	const output_rel = request_url.replace(/^\//, "").replace(/\/$/, "") + "/index.html";

	ctx.generated_routes.add(request_url);

	const pagination_data = paginate(records.length, page, per_page, {
		show_when_single_page: pagination_config.show_when_single_page,
		always_show_prev_next: pagination_config.always_show_prev_next,
		labels,
	}, page_url);

	const page_records = records.slice((page - 1) * per_page, page * per_page);

	const hreflang_links = build_hreflang_links({
		site_url: options.site_url,
		locales,
		soft_launch_locales: ctx.soft_launch_locales,
		default_locale,
		url_for_locale: (l) => page_url_for_locale(l, page),
	});

	// Each numbered page is its own canonical (index all pages).
	const canonical_url = options.site_url ? abs_url(options.site_url, request_url) : "";

	const data = build_page_data(
		ctx,
		{
			locale,
			locale_url_prefix,
			request_url,
			canonical_path,
			canonical_url,
			hreflang_links,
			site_name: String(merged.site_name ?? ""),
		},
		{
			records: page_records,
			pagination: pagination_data,
			pagination_variant: pagination_config.variant,
			// `merged` stays flat for existing props.<key> access (route JSON also
			// carries non-string page data); `translations` is the {_ }/{- } root.
			translations: merged,
		}
	);

	const rendered_html = await engine.render(template_name, data);
	const html = normalize_internal_page_links(rendered_html);
	await write_page(join(options.dist_dir, output_rel), html, options.public_dir, options.dist_dir);

	return { output_rel, request_url, last_page };
}

/**
 * Render all paginated routes. `all_page_files` is forwarded to the record
 * resolver (markdown collection by default). Generated request URLs are
 * recorded on `ctx.generated_routes`.
 */
export async function render_paginated_routes(ctx: BuildContext, all_page_files: string[], paginated_index_rels: Set<string>): Promise<PaginationTally> {
	const { options, locales } = ctx;

	let rendered = 0;
	let errors = 0;
	let actual_pagination_count = 0;
	const formula_pagination_count = paginated_index_rels.size * locales.length;

	if (!pagination_config.enabled || pagination_config.routes.length === 0) {
		return { rendered, errors, formula_pagination_count: 0, actual_pagination_count };
	}

	console.log("");
	console.log("📄 Rendering paginated routes...");

	for (const route of pagination_config.routes) {
		const route_dir = route.route.replace(/^\/+|\/+$/g, "");
		const index_rel = `${route_dir}/index.ree`;
		const index_full = join(options.public_dir, index_rel);

		if (!existsSync(index_full)) {
			console.warn(`    ⚠  Pagination route "${route_dir}" has no ${index_rel} - skipping`);
			continue;
		}

		for (const locale of locales) {
			let last_page = 0;
			let records_count = 0;
			try {
				const records = await resolve_route_records(
					options.public_dir,
					route,
					locale,
					all_page_files,
					new Date(),
					project_hooks.content_visibility
				);
				records_count = records.length;
				const index_source = readFileSync(index_full, "utf-8");
				const per_page = resolve_per_page(index_source, route.per_page, pagination_config.per_page);
				last_page = chunk_count(records.length, per_page);

				for (let page = 1; page <= last_page; page++) {
					try {
						const result = await render_pagination_page(ctx, route, locale, page, all_page_files);
						rendered++;
						actual_pagination_count++;
						if (options.verbose) console.log(
							`    ✓ (page ${page}/${last_page}) ${result.output_rel}`
						);
					} catch (err) {
						errors++;
						const msg = err instanceof Error ? err.message : String(err);
						console.error(`    ✗ ${locale}/${index_rel} page ${page}: ${msg}`);
					}
				}
			} catch (err) {
				errors++;
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`    ✗ ${locale}/${index_rel}: ${msg}`);
			}

			console.log(
				`    📄 /${route_dir} [${locale}]: ${records_count} record(s) → ${last_page} page(s)`
			);
		}
	}

	return { rendered, errors, formula_pagination_count, actual_pagination_count };
}
