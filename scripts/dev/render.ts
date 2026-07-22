/**
 * scripts/dev/render.ts
 *
 * Per-request rendering of .ree templates and .md files. Each builds dev render
 * data, renders through the engine, and returns an HTML response with the
 * live-reload client injected.
 */

import { dirname, join, relative, resolve } from "path";

import { default_language, languages } from "$config/supported_languages";
import { resolve_visibility } from "$lib/content_visibility";
import { parse_frontmatter, path_to_namespace, template_to_canonical } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";

import { resolve_md_file } from "../ssg/markdown";
import { render_markdown_body } from "../shared/markdown";
import { normalize_internal_page_links } from "../shared/routing";
import type { DevContext } from "./context";
import { inject_live_reload } from "./live_reload";
import { build_dev_page_data } from "./page_data";
import { respond_error, respond_html, respond_not_found } from "./responses";
import { sidebar_links_for } from "./sidebar";
import { load_template_data } from "./template_data";

/** request URL (trailing slash) for a localized path under a language prefix. */
function request_url_for(localized_path: string, lang_url_prefix: string): string {
	return localized_path === "/" ? lang_url_prefix + "/" : lang_url_prefix + localized_path + "/";
}

/** Render a .ree template for `lang`. */
export async function render_ree(ctx: DevContext, rel_path: string, lang: string): Promise<Response> {
	const { engine, state } = ctx;
	try {
		const canonical_path = template_to_canonical(rel_path);
		const localized_path = state.resolve_localized_path(canonical_path, lang);
		const lang_url_prefix = lang === default_language ? "" : `/${lang}`;

		const merged = state.merge_strings(lang, path_to_namespace(rel_path));
		const template_data = await load_template_data(rel_path, state.public_dir);

		const data = build_dev_page_data(state, {
			lang,
			lang_url_prefix,
			request_url: request_url_for(localized_path, lang_url_prefix),
			canonical_path,
			site_name: String(merged.site_name ?? ""),
		}, { ...template_data, translations: merged });

		const rendered_html = await engine.render(rel_path.replace(/\.ree$/, ""), data);
		const html = normalize_internal_page_links(rendered_html);
		return respond_html(await inject_live_reload(html));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`    ✗ ${lang}/${rel_path}: ${msg}`);
		return respond_error(msg);
	}
}

/** Render a .md file for `lang` through its resolved layout. */
export async function render_md(ctx: DevContext, rel_path: string, layout: string, lang: string): Promise<Response> {
	const { engine, state, sidebar_map } = ctx;
	try {
		const resolved = await resolve_md_file(rel_path, lang, default_language, state.public_dir);
		if (!resolved) return respond_not_found();

		const { data: frontmatter, body: markdown_body } = parse_frontmatter(resolved.content);
		const canonical_path = template_to_canonical(resolved.resolved_path);

		// Visibility policy (same as the static build): `render: false` (project
		// hook only) 404s; `index: false` forces robots:noindex for drafts /
		// future-dated posts so dev previews match production.
		const visibility = resolve_visibility(
			frontmatter,
			new Date(),
			canonical_path,
			lang,
			project_hooks.content_visibility
		);
		if (!visibility.render) return respond_not_found();

		const md_abs_path = join(state.public_dir, resolved.resolved_path);
		const source_dir = dirname(md_abs_path);
		// Inspector: stamp .md blocks with the project-root-relative source path.
		const stamp_file = relative(resolve("."), md_abs_path).split("\\").join("/");
		const { html: raw_body, headings } = await render_markdown_body(markdown_body, {
			source_dir,
			stamp_file,
		});
		const merged = state.merge_strings(lang, path_to_namespace(resolved.resolved_path));

		const localized_path = state.resolve_localized_path(canonical_path, lang);
		const lang_url_prefix = lang === default_language ? "" : `/${lang}`;

		// Seam 5: project may transform the body and contribute extra fields.
		const shaped = project_hooks.shape_md_page?.({
			canonical_path,
			lang,
			frontmatter,
			html_body: raw_body,
			headings,
			public_dir: state.public_dir,
			md_files: state.md_files,
			languages,
			default_language,
		}) ?? { body: raw_body };

		const data = build_dev_page_data(
			state,
			{
				lang,
				lang_url_prefix,
				request_url: request_url_for(localized_path, lang_url_prefix),
				canonical_path,
				site_name: String(frontmatter.site_name || merged.site_name || ""),
			},
			{
				...state.translations[lang]?.routes,
				sidebar: sidebar_links_for(canonical_path, lang, sidebar_map, state),
				body: shaped.body,
				...shaped.fields,
				...frontmatter,
				...(visibility.index ? {} : { noindex: true }),
				// {_ }/{- } lookup root (layout.ree renders through here too).
				translations: state.translations[lang]?.routes,
			}
		);

		const rendered_html = await engine.render(layout, data);
		const html = normalize_internal_page_links(rendered_html);
		return respond_html(await inject_live_reload(html));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`    ✗ ${lang}/${rel_path}: ${msg}`);
		return respond_error(msg);
	}
}
