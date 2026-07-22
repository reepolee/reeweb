/**
 * scripts/ssg/render_templates.ts
 *
 * Render phase for hand-authored .ree templates: one HTML file per template
 * per language. Paginated route indexes are skipped here (the pagination phase
 * owns them). Each .ree variant is its own canonical, indexable page.
 */

import { join } from "path";

import { path_to_namespace, template_to_canonical } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";

import { normalize_internal_page_links } from "../shared/routing";
import { build_page_data } from "./page_data";
import { output_target } from "./routing";
import { abs_url, build_hreflang_links } from "./seo";
import { merge_route_strings } from "./translation_merge";
import type { BuildContext, RenderTally } from "./types";
import { write_page } from "./write_page";

/**
 * Render a single .ree template for one language and write it to dist/.
 * Shared by the batch phase (`render_ree_templates`) and the single-page
 * print-url path, so both stay byte-for-byte identical.
 */
export async function render_ree_template_for_lang(ctx: BuildContext, rel_path: string, lang: string, template_data_map: Map<string, Record<string, any>>): Promise<{ output_rel: string; verbose_label: string; request_url: string; }> {
	const { engine, options, languages, default_language, language_locales, route_resolver } = ctx;
	const { localized_url_for_lang, resolve_localized_path } = route_resolver;

	const template_name = rel_path.replace(/\.ree$/, "");
	const canonical_path = template_to_canonical(rel_path);
	const namespace = path_to_namespace(rel_path);

	const merged = merge_route_strings(ctx.translations, lang, namespace);
	const localized_path = resolve_localized_path(canonical_path, lang);
	const { output_rel, verbose_label, lang_url_prefix, request_url, is_default } = output_target(
		localized_path,
		lang,
		default_language
	);

	ctx.generated_routes.add(request_url);

	// Seam 3: hand-authored .ree pages are localized by default; a project
	// can mark a path English-only so non-default variants canonicalize to
	// the default URL and drop out of the hreflang cluster.
	const localized = project_hooks.is_localized_path?.(canonical_path, lang) ?? true;

	const hreflang_links = localized ? build_hreflang_links({
		site_url: options.site_url,
		languages,
		soft_launch_languages: ctx.soft_launch_languages,
		default_language,
		url_for_lang: (l) => localized_url_for_lang(canonical_path, l),
	}) : [];

	// A page is its own canonical, except a non-default variant of a
	// non-localized page, which canonicalizes to the default-language URL.
	const canonical_self = is_default || localized;
	const canonical_url = options.site_url ? abs_url(options.site_url, canonical_self ? request_url : localized_url_for_lang(
		canonical_path,
		default_language
	)) : "";

	const data = build_page_data(
		ctx,
		{
			lang,
			lang_url_prefix,
			locale: language_locales[lang] ?? "",
			request_url,
			canonical_path,
			canonical_url,
			hreflang_links,
			site_name: "Static Site",
		},
		{
			// Template data first so merged translations can override if needed.
			// `merged` is still spread flat for existing props.<key> access
			// (route JSON also carries non-string page data like `highlights`);
			// `translations` gives {_ path}/{- path} their fixed lookup root.
			...template_data_map.get(rel_path),
			translations: merged,
		}
	);

	const rendered_html = await engine.render(template_name, data);
	const html = normalize_internal_page_links(rendered_html);
	await write_page(join(options.dist_dir, output_rel), html);

	return { output_rel, verbose_label, request_url };
}

/**
 * Render every .ree template (except paginated indexes) across all languages.
 * `template_data_map` supplies per-template dynamic data loaded from sibling
 * .ts files. Generated request URLs are recorded on `ctx.generated_routes`.
 */
export async function render_ree_templates(ctx: BuildContext, ree_files: string[], paginated_index_rels: Set<string>, template_data_map: Map<string, Record<string, any>>): Promise<RenderTally> {
	const { languages } = ctx;

	console.log("🖨️ Rendering templates...");

	let rendered = 0;
	let errors = 0;

	for (const rel_path of ree_files) {
		// Paginated route indexes are rendered by the pagination phase.
		if (paginated_index_rels.has(rel_path)) continue;

		console.log(`    Rendering ${rel_path}...`);

		for (const lang of languages) {
			try {
				const { verbose_label } = await render_ree_template_for_lang(ctx, rel_path, lang, template_data_map);
				rendered++;
				if (ctx.options.verbose) { console.log(`    ✓ ${verbose_label}`); }
			} catch (err) {
				errors++;
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`    ✗ ${lang}/${rel_path}: ${msg}`);
			}
		}
	}

	return { rendered, errors };
}
