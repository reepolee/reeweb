/**
 * scripts/ssg/pipeline.ts
 *
 * Build orchestrator. Parses options, prepares dist/, loads translations and
 * the route map, assembles the shared BuildContext, then runs the render
 * phases (templates → markdown → pagination), copies static assets, emits
 * redirects, and prints the summary. The heavy lifting lives in the focused
 * modules; this file just wires them together (cf. lib/template_engine.ts).
 */

import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { pathToFileURL } from "url";

import { pagination as pagination_config } from "$config/pagination";
import { redirects as raw_redirects } from "$config/redirects";
import {
	active_languages,
	default_language,
	language_locales,
	language_names,
	languages,
	soft_launch_languages,
} from "$config/supported_languages";
import { load_all_translations } from "$lib/i18n";
import { check_collisions_and_validate_targets, emit_redirects, load_and_validate_redirects } from "$lib/redirects";
import { build_static_route_map, collect_page_files, find_ree_md_collisions, walk_dir } from "$lib/static_site";
import TemplateEngine from "$lib/template_engine";

import { without_draft_pages } from "$lib/draft_pages";

import { clear_directory } from "../shared/clear_directory";
import { parse_args } from "./cli";
import { find_schema_files, validate_collections } from "./collections";
import { render_markdown_files } from "./render_markdown";
import { render_paginated_routes } from "./render_pagination";
import { render_ree_templates } from "./render_templates";
import { create_route_resolver } from "./routing";
import { build_sidebar_map } from "./sidebar";
import type { BuildContext, BuildOptions } from "./types";

/**
 * Load dynamic data for templates that have a sibling .ts file exporting
 * `load_template_data()`. Paginated indexes are skipped (they resolve their
 * own records in the pagination phase).
 */
async function load_template_data_map(ree_files: string[], paginated_index_rels: Set<string>, public_dir: string, verbose: boolean): Promise<Map<string, Record<string, any>>> {
	const template_data_map = new Map<string, Record<string, any>>();

	console.log("📊 Loading data files...");

	for (const rel_path of ree_files) {
		if (paginated_index_rels.has(rel_path)) continue;

		const data_rel_path = rel_path.replace(/\.ree$/, ".ts");
		const data_full_path = join(public_dir, data_rel_path);
		if (!existsSync(data_full_path)) continue;

		if (verbose) { console.log(`    📊 Loading data from ${data_rel_path}`); }

		try {
			// Dynamic import on Windows needs a file:// URL or it can hang.
			const data_module = await import(pathToFileURL(data_full_path).href);

			if (typeof data_module.load_template_data === "function") {
				const result = await data_module.load_template_data();
				template_data_map.set(rel_path, result ?? {});
				console.log(`    ✓ Data loaded for ${rel_path}`);
			} else {
				console.warn(`    ⚠  ${data_rel_path} does not export load_template_data()`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`    ⚠  Could not load ${data_rel_path}: ${msg}`);
		}
	}

	if (template_data_map.size > 0) {
		console.log(`    ✓ ${template_data_map.size} data file(s) loaded`);
	} else {
		console.log("    No data files to load");
	}

	return template_data_map;
}

/** Run the full SSG pass. Returns render/error counts instead of exiting. */
export async function run_ssg(options: BuildOptions = parse_args()): Promise<{ rendered: number; errors: number; }> {
	const { public_dir, dist_dir, base_url, site_url, verbose } = options;

	console.log(`📂 Source:  ${public_dir}`);
	console.log(`📦 Output:  ${dist_dir}`);
	console.log(`🌐 Base:    ${base_url || "/"}`);
	if (site_url) {
		console.log(`🔗 Site URL: ${site_url}`);
	} else {
		console.log(
			`    ⚠  No --site-url provided - skipping hreflang links (Google requires absolute URLs)`
		);
	}
	console.log("");

	if (!existsSync(public_dir)) { throw new Error(`Source directory does not exist: ${public_dir}`); }

	// Phase 1: schema-validate redirects before doing any work.
	// Collision checks and target validation happen in Phase 2, after dist/ is built.
	const redirects = load_and_validate_redirects(raw_redirects);
	if (redirects.length > 0) {
		console.log(`🔗 Redirects: ${redirects.length} declared`);
		console.log("");
	}

	// Track what the build produces, so Phase 2 can detect collisions.
	const generated_routes = new Set<string>();
	const static_asset_paths = new Set<string>();

	// Preserve the dist/ directory itself because preview servers may watch it.
	clear_directory(dist_dir);

	// 1. Load translations from public/ (same loader as lib/i18n.ts).
	console.log("📖 Loading translations...");
	const translations = await load_all_translations(public_dir, languages);
	console.log(`    ✓ ${languages.length} language(s) loaded`);

	// Self-names for the switcher come from each language's own translation file
	// (en.json says "English", sl.json says "Slovenščina").
	const language_self_names: Record<string, string> = {};
	for (const lang of languages) {
		language_self_names[lang] = translations[lang]?.routes?.ui?.language_names?.[lang] ?? lang;
	}

	// URL prefixes: default language at root (""), others at "/{lang}".
	const language_urls: Record<string, string> = {};
	for (const lang of languages) {
		language_urls[lang] = lang === default_language ? "" : `/${lang}`;
	}

	// 2. Template engine pointed at public/.
	const engine = new TemplateEngine({
		views: public_dir,
		ext: ".ree",
		cache: false,
		auto_escape: true,
	});

	// 3. Walk public/ and split into renderable templates vs static assets.
	const all_files = walk_dir(public_dir);
	const all_page_files = without_draft_pages(collect_page_files(public_dir, languages));
	const ree_files = all_page_files.filter((f) => f.endsWith(".ree"));
	const md_files = all_page_files.filter((f) => f.endsWith(".md"));

	// A route backed by both a .ree and a .md is ambiguous: .ree wins and the
	// .md is silently shadowed. Fail loud rather than ship a page whose source
	// is unclear (the dev server only warns; see scripts/dev.ts).
	const ree_md_collisions = find_ree_md_collisions(ree_files, md_files);
	if (ree_md_collisions.length > 0) {
		console.error(`\n✗ Route collision: ${ree_md_collisions.length} route(s) have both a .ree and a .md source (.ree wins, .md is shadowed):`);
		for (const collision of ree_md_collisions) {
			console.error(`    ${collision.canonical || "/"} - ${collision.ree} vs ${collision.md}`);
		}
		throw new Error(`Route collision: ${ree_md_collisions.length} route(s) backed by both .ree and .md - remove one source per route`);
	}

	// A `.ts` file is treated as source (a template-data sibling like about.ts
	// next to about.ree, loaded by load_template_data_map) only when a matching
	// `.ree` exists - the same pairing that loader resolves (see .ree -> .ts at
	// load_template_data_map). A `.ts` with no `.ree` sibling (e.g. an HLS video
	// segment) is a static asset and must be copied.
	const ree_path_set = new Set(all_files.filter((f) => f.endsWith(".ree")));
	const static_files: string[] = [];
	for (const file of all_files) {
		const data_sibling_ree = file.endsWith(".ts") ? file.replace(/\.ts$/, ".ree") : "";
		const is_source_ts = file.endsWith(".ts") && ree_path_set.has(data_sibling_ree);
		if (!file.endsWith(".ree") && !file.endsWith(".json") && !is_source_ts && !file.endsWith(
			".md"
		)) { static_files.push(file); }
	}

	// Index templates of paginated routes are rendered by the pagination phase
	// (once per page-number), not the normal .ree loop. They stay in `ree_files`
	// so the route map still knows /<route>.
	const paginated_index_rels = new Set<string>();
	if (pagination_config.enabled) {
		for (const route of pagination_config.routes) {
			const route_dir = route.route.replace(/^\/+|\/+$/g, "");
			paginated_index_rels.add(`${route_dir}/index.ree`);
		}
	}

	const raw_ree_count = all_files.filter((f) => f.endsWith(".ree")).length;
	const raw_md_count = all_files.filter((f) => f.endsWith(".md")).length;
	console.log(`    📄 ${ree_files.length} template(s) found (from ${raw_ree_count} file(s))`);
	console.log(`    📝 ${md_files.length} markdown file(s) found (from ${raw_md_count} file(s))`);
	console.log(`    🎨 ${static_files.length} static file(s) found`);
	console.log("");

	// 3b. Content collections - validate frontmatter before rendering anything.
	if (find_schema_files(all_files).length > 0) {
		const collection_issues = await validate_collections(all_files, public_dir);
		if (collection_issues.length > 0) {
			console.error(
				`\n✗ Content collection validation failed (${collection_issues.length} issue(s)):`
			);
			for (const issue of collection_issues) {
				console.error(`    ${issue.file} - ${issue.field}: ${issue.message}`);
			}
			throw new Error(
				`Content collection validation failed with ${collection_issues.length} issue(s)`,
			);
		}
		console.log("");
	}

	// 3c. Load dynamic data for templates with a sibling .ts file.
	const template_data_map = await load_template_data_map(
		ree_files,
		paginated_index_rels,
		public_dir,
		verbose
	);

	// Build route map for localized path resolution.
	console.log("🗺️ Building route map...");
	const route_map = build_static_route_map(translations, [...ree_files, ...md_files], languages);
	console.log(`    ✓ ${route_map.size} template(s) mapped`);

	// 4. Assemble the shared build context handed to every render phase.
	const ctx: BuildContext = {
		engine,
		options,
		languages,
		active_languages,
		default_language,
		language_names,
		language_locales,
		soft_launch_languages,
		language_self_names,
		language_urls,
		translations,
		route_resolver: create_route_resolver(route_map, default_language),
		year: new Date().getFullYear(),
		generated_routes,
	};

	// 5. Render phases.
	const ree_tally = await render_ree_templates(
		ctx,
		ree_files,
		paginated_index_rels,
		template_data_map
	);

	const sidebar_map = await build_sidebar_map(md_files, ctx);
	const md_tally = await render_markdown_files(ctx, md_files, sidebar_map);

	const pagination_tally = await render_paginated_routes(
		ctx,
		all_page_files,
		paginated_index_rels
	);

	const rendered_count = ree_tally.rendered + md_tally.rendered + pagination_tally.rendered;
	const error_count = ree_tally.errors + md_tally.errors + pagination_tally.errors;

	// 6. Copy static files to dist root.
	for (const rel_path of static_files) {
		const dest_path = join(dist_dir, rel_path);
		mkdirSync(dirname(dest_path), { recursive: true });
		copyFileSync(join(public_dir, rel_path), dest_path);
		static_asset_paths.add("/" + rel_path.split(/[\\/]/).join("/"));
	}

	// 7. Phase 2: collision-check and emit redirects (dist/ is now final).
	if (redirects.length > 0) {
		check_collisions_and_validate_targets(
			redirects,
			dist_dir,
			generated_routes,
			static_asset_paths
		);
		await emit_redirects(redirects, dist_dir);
		console.log(`    🔗 ${redirects.length} redirect(s) emitted (dist/_redirects + HTML stubs)`);
	}

	// 8. Summary. The flat formula assumes 1 render per paginated route per
	// language; correct it by the actual page count produced.
	const flat_total = (ree_files.length + md_files.length) * languages.length;
	const total = flat_total + (pagination_tally.actual_pagination_count - pagination_tally.formula_pagination_count);

	console.log("");
	console.log("═".repeat(50));
	console.log(`✅ Static Site Generation complete`);
	console.log(`  Templates rendered:  ${rendered_count}/${total}`);
	if (error_count > 0) { console.log(`  Errors:             ${error_count}`); }
	console.log(`  Static files copied: ${static_files.length}`);
	console.log(`  Output directory:    ${dist_dir}`);
	console.log("═".repeat(50));

	return { rendered: rendered_count, errors: error_count };
}
