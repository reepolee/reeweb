/**
 * scripts/ssg/render_markdown.ts
 *
 * Render phase for .md files: parse frontmatter, convert the body to HTML
 * (Bun.markdown + the docs post-processor), pick a layout, and render through
 * the template engine - once per language with the localized fallback chain.
 *
 * SEO nuance: pages with `localize: false` have byte-identical content in every
 * language, so non-default variants canonicalize to the default URL and are
 * left out of the hreflang cluster (see page_is_localized).
 */

import { existsSync } from "fs";
import { dirname, join } from "path";

import { resolve_visibility } from "$lib/content_visibility";
import { page_is_localized, parse_frontmatter, template_to_canonical } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";

import { render_markdown_body } from "../shared/markdown";
import { normalize_internal_page_links } from "../shared/routing";
import { resolve_md_file } from "./markdown";
import { build_page_data } from "./page_data";
import { output_target } from "./routing";
import { abs_url, build_hreflang_links } from "./seo";
import { sidebar_links_for } from "./sidebar";
import type { BuildContext, RenderTally, SidebarEntry } from "./types";
import { write_page } from "./write_page";

/** Resolve the layout template name for a markdown page from its frontmatter. */
function resolve_layout(frontmatter: Record<string, any>, public_dir: string): string {
	const raw_layout = frontmatter.layout || "layout";
	const base_layout = String(raw_layout).replace(/\.ree$/, "").replace(/\.layout$/, "");
	for (const candidate of [`${base_layout}.layout`, base_layout]) {
		if (existsSync(join(public_dir, candidate + ".ree"))) return candidate;
	}
	return "layout";
}

/**
 * Render a single markdown file for one language and write it to dist/.
 * Shared by the batch phase (`render_markdown_files`) and the single-page
 * print-url path, so both stay byte-for-byte identical. Returns null when
 * the page is intentionally skipped (`render: false` visibility).
 */
export async function render_md_file_for_lang(ctx: BuildContext, base_rel_path: string, lang: string, md_files: string[], sidebar_map: Map<string, Map<string, SidebarEntry[]>>): Promise<{ output_rel: string; verbose_label: string; request_url: string; } | null> {
	const { engine, options, languages, default_language, language_locales, route_resolver } = ctx;
	const { localized_url_for_lang, resolve_localized_path } = route_resolver;
	const public_dir = options.public_dir;

	const canonical_path = template_to_canonical(base_rel_path);

	const resolved = await resolve_md_file(base_rel_path, lang, default_language, public_dir);
	if (!resolved) { throw new Error("markdown file not found"); }

	const { data: frontmatter, body: markdown_body } = parse_frontmatter(resolved.content);

	// Visibility policy. `render: false` (only reachable via a project hook)
	// drops the page entirely; the default always renders. `index: false`
	// forces robots:noindex below - this fires for drafts/future-dated posts
	// and is a no-op for published pages that already set `noindex: true`.
	const visibility = resolve_visibility(
		frontmatter,
		new Date(),
		canonical_path,
		lang,
		project_hooks.content_visibility
	);
	if (!visibility.render) return null;

	const source_dir = dirname(join(public_dir, resolved.resolved_path));
	const { html: raw_body, headings } = await render_markdown_body(markdown_body, { source_dir });

	// Seam 4: project may override layout resolution; else use the built-in.
	const layout = project_hooks.resolve_md_layout?.(base_rel_path, frontmatter, public_dir) ?? resolve_layout(
		frontmatter,
		public_dir
	);
	const localized_path = resolve_localized_path(canonical_path, lang);
	const { output_rel, verbose_label, lang_url_prefix, request_url, is_default } = output_target(
		localized_path,
		lang,
		default_language
	);

	ctx.generated_routes.add(request_url);

	// Seam 3: frontmatter opt-out AND the project's path-based SEO policy.
	const localized = page_is_localized(frontmatter) && (project_hooks.is_localized_path?.(canonical_path, lang) ?? true);

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

	// Seam 5: project may transform the body and contribute extra fields
	// (toc, docs sidebar groups, …); default leaves the body unchanged.
	const shaped = project_hooks.shape_md_page?.({
		canonical_path,
		lang,
		frontmatter,
		html_body: raw_body,
		headings,
		public_dir,
		md_files,
		languages,
		default_language,
	}) ?? { body: raw_body };

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
			site_name: String(frontmatter.site_name || "Static Site"),
		},
		{
			...ctx.translations[lang]?.routes,
			sidebar: sidebar_links_for(canonical_path, lang, sidebar_map, ctx),
			body: shaped.body,
			...shaped.fields,
			...frontmatter,
			// Drafts / future-dated posts are noindexed even without an explicit
			// frontmatter key (override placed after the frontmatter spread).
			...(visibility.index ? {} : { noindex: true }),
			// {_ }/{- } lookup root (layout.ree renders through here too).
			translations: ctx.translations[lang]?.routes,
		}
	);

	const rendered_html = await engine.render(layout, data);
	const html = normalize_internal_page_links(rendered_html);
	await write_page(join(options.dist_dir, output_rel), html);

	return { output_rel, verbose_label, request_url };
}

/**
 * Render every markdown file across all languages. `sidebar_map` supplies
 * per-folder navigation (see build_sidebar_map). Generated request URLs are
 * recorded on `ctx.generated_routes`.
 */
export async function render_markdown_files(ctx: BuildContext, md_files: string[], sidebar_map: Map<string, Map<string, SidebarEntry[]>>): Promise<RenderTally> {
	const { options, languages } = ctx;

	if (md_files.length > 0) { console.log("📝 Rendering markdown files..."); }

	let rendered = 0;
	let errors = 0;

	for (const base_rel_path of md_files) {
		if (options.verbose) { console.log(`    Rendering markdown ${base_rel_path}...`); }

		for (const lang of languages) {
			try {
				const result = await render_md_file_for_lang(ctx, base_rel_path, lang, md_files, sidebar_map);
				if (!result) continue;
				rendered++;
				if (options.verbose) { console.log(`    ✓ (md) ${result.verbose_label}`); }
			} catch (err) {
				errors++;
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`    ✗ ${lang}/${base_rel_path}: ${msg}`);
			}
		}
	}

	return { rendered, errors };
}
