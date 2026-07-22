/**
 * scripts/ssg/print_page.ts
 *
 * Renders exactly one page for `--print-url`, without building the rest of
 * the site. Loads the same cheap metadata a full build loads (translations,
 * page-file inventory, route map - no template rendering), resolves the
 * request URL to a language + template/markdown/pagination match the way the
 * dev server does, then renders only that page through the same render
 * functions the batch phases use (render_ree_template_for_lang /
 * render_md_file_for_lang / render_pagination_page), so the output is
 * byte-for-byte what a full build would have produced for that URL.
 */

import { existsSync } from "fs";
import { join } from "path";

import { pagination as pagination_config } from "$config/pagination";
import {
	active_languages,
	default_language,
	language_locales,
	language_names,
	languages,
	soft_launch_languages,
} from "$config/supported_languages";
import { without_draft_pages } from "$lib/draft_pages";
import { load_all_translations } from "$lib/i18n";
import { build_static_route_map, collect_page_files, template_to_canonical } from "$lib/static_site";
import TemplateEngine from "$lib/template_engine";

import { render_md_file_for_lang } from "./render_markdown";
import { render_pagination_page } from "./render_pagination";
import { render_ree_template_for_lang } from "./render_templates";
import { create_route_resolver } from "./routing";
import { build_sidebar_map } from "./sidebar";
import type { BuildContext, BuildOptions } from "./types";

/** Parse a request path into { lang, path } the way the dev server does. */
function split_lang_prefix(request_path: string): { lang: string; canonical_guess: string; } {
	const normalized = request_path.replace(/\/+$/, "") || "/";
	const segments = normalized.split("/").filter(Boolean);
	const first = segments[0];

	if (first && (languages as readonly string[]).includes(first)) {
		const rest = segments.slice(1);
		return { lang: first, canonical_guess: rest.length > 0 ? "/" + rest.join("/") : "/" };
	}

	return { lang: default_language, canonical_guess: normalized };
}

/** Match a language-stripped path to a pagination route + page number. */
function match_pagination(localized_path: string, lang: string, canonical_to_localized: (canonical: string, lang: string) => string): { route_dir: string; page: number; } | null {
	if (!pagination_config.enabled) return null;
	const seg = pagination_config.path_segment;

	for (const route of pagination_config.routes) {
		const route_dir = route.route.replace(/^\/+|\/+$/g, "");
		const canonical_base = "/" + route_dir;
		const localized_base = canonical_to_localized(canonical_base, lang);

		if (localized_path === localized_base) return { route_dir, page: 1 };

		const prefix = seg ? `${localized_base}/${seg}/` : `${localized_base}/`;
		if (localized_path.startsWith(prefix)) {
			const rest = localized_path.slice(prefix.length);
			if (/^\d+$/.test(rest)) return { route_dir, page: parseInt(rest, 10) };
		}
	}

	return null;
}

/**
 * Render only the page for `request_url` and return its dist-relative output
 * path. Throws if the URL doesn't resolve to any known page/pagination route.
 */
export async function print_single_page(options: BuildOptions, request_url: string): Promise<string> {
	const { public_dir } = options;

	if (!existsSync(public_dir)) { throw new Error(`Source directory does not exist: ${public_dir}`); }

	const translations = await load_all_translations(public_dir, languages);

	const language_self_names: Record<string, string> = {};
	for (const lang of languages) {
		language_self_names[lang] = translations[lang]?.routes?.ui?.language_names?.[lang] ?? lang;
	}

	const language_urls: Record<string, string> = {};
	for (const lang of languages) {
		language_urls[lang] = lang === default_language ? "" : `/${lang}`;
	}

	const engine = new TemplateEngine({ views: public_dir, ext: ".ree", cache: false, autoEscape: true });

	const all_page_files = without_draft_pages(collect_page_files(public_dir, languages));
	const ree_files = all_page_files.filter((f) => f.endsWith(".ree"));
	const md_files = all_page_files.filter((f) => f.endsWith(".md"));

	const route_map = build_static_route_map(translations, [...ree_files, ...md_files], languages);
	const route_resolver = create_route_resolver(route_map, default_language);

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
		route_resolver,
		year: new Date().getFullYear(),
		generated_routes: new Set<string>(),
	};

	const { lang, canonical_guess } = split_lang_prefix(request_url);

	// Pagination routes take precedence, mirroring the dev server's dispatch order.
	const pagination_match = match_pagination(
		canonical_guess,
		lang,
		(canonical, l) => route_resolver.localized_url_for_lang(canonical, l)
	);
	if (pagination_match) {
		const route = pagination_config.routes.find((r) => r.route.replace(/^\/+|\/+$/g, "") === pagination_match.route_dir);
		if (!route) { throw new Error(`--print-url: pagination route "${pagination_match.route_dir}" not found in config`); }
		const result = await render_pagination_page(ctx, route, lang, pagination_match.page, all_page_files);
		return result.output_rel;
	}

	// Canonical→template lookup: reverse the localized path back to canonical.
	const canonical_to_template = new Map<string, string>();
	for (const rel_path of all_page_files) {
		const canonical = template_to_canonical(rel_path);
		const existing = canonical_to_template.get(canonical);
		const ree_beats_md = existing !== undefined && existing.endsWith(".md") && rel_path.endsWith(".ree");
		if (existing === undefined || ree_beats_md) { canonical_to_template.set(canonical, rel_path); }
	}

	let canonical_path = canonical_guess;
	if (!canonical_to_template.has(canonical_path)) {
		const resolved = route_resolver.resolve_canonical_from_localized(canonical_guess, lang);
		if (resolved) { canonical_path = resolved; }
	}

	const template = canonical_to_template.get(canonical_path);
	if (!template) { throw new Error(`--print-url: no page found for "${request_url}"`); }

	if (template.endsWith(".ree")) {
		// Sibling .ts data file, if any (same convention as the batch loop).
		const data_full_path = join(public_dir, template.replace(/\.ree$/, ".ts"));
		const template_data_map = new Map<string, Record<string, any>>();
		if (existsSync(data_full_path)) {
			const { pathToFileURL } = await import("url");
			const data_module = await import(pathToFileURL(data_full_path).href);
			if (typeof data_module.load_template_data === "function") {
				template_data_map.set(template, (await data_module.load_template_data()) ?? {});
			}
		}
		const result = await render_ree_template_for_lang(ctx, template, lang, template_data_map);
		return result.output_rel;
	}

	const sidebar_map = await build_sidebar_map(md_files, ctx);
	const result = await render_md_file_for_lang(ctx, template, lang, md_files, sidebar_map);
	if (!result) { throw new Error(`--print-url: page "${request_url}" is not rendered (visibility policy hides it)`); }
	return result.output_rel;
}
