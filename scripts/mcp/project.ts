#!/usr/bin/env bun
/**
 * MCP Server - Project helpers
 *
 * Project-state introspection for the reeweb static site: pages, the localized
 * route map, translations (per-language JSON files), components, config, code
 * search, and template analysis.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { file, spawnSync } from "bun";

import pkg_json from "../../package.json";

import { pagination } from "$config/pagination";
import { redirects } from "$config/redirects";
import {
	active_languages,
	default_language,
	language_locales,
	language_names,
	languages,
	soft_launch_languages,
} from "$config/supported_languages";
import { is_underscore_draft, without_draft_pages } from "$lib/draft_pages";
import { load_all_translations } from "$lib/i18n";
import {
	collect_page_files,
	build_static_route_map,
	path_to_namespace,
	read_frontmatter,
	template_to_canonical,
	walk_dir,
} from "$lib/static_site";

import { build_code_search_args, COMPONENTS_DIR, PROJECT_ROOT, PUBLIC_DIR } from "./paths";

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageInfo = {
	/** Canonical page file relative to src/public (language variants collapsed). */
	path: string;
	/** Canonical route, e.g. "/about". */
	route: string;
	kind: "ree" | "md";
	/** Translation namespace, e.g. "blog.post". */
	namespace: string;
	/** Underscore-prefixed draft: not built, not routed. */
	draft: boolean;
	/** Actual files on disk backing this page (base + per-language variants). */
	files: string[];
	/** Whether a sibling .ts data loader exists (load_template_data). */
	has_data_loader: boolean;
};

function escape_regex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function list_pages(): PageInfo[] {
	const all_files = walk_dir(PUBLIC_DIR);
	const pages = collect_page_files(PUBLIC_DIR, languages);
	const lang_group = languages.join("|");

	const infos = pages.map((rel): PageInfo => {
		const kind = rel.endsWith(".md") ? "md" as const : "ree" as const;
		const base = rel.replace(/\.(ree|md)$/, "");
		const variant_re = new RegExp(`^${escape_regex(base)}(\\.(${lang_group}))?\\.(ree|md)$`);
		const files = all_files.filter((f) => variant_re.test(f));

		return {
			path: rel,
			route: template_to_canonical(rel),
			kind,
			namespace: path_to_namespace(rel),
			draft: is_underscore_draft(rel),
			files,
			has_data_loader: all_files.includes(`${base}.ts`),
		};
	});

	return infos.sort((a, b) => a.route.localeCompare(b.route));
}

// ---------------------------------------------------------------------------
// Route map (canonical → localized output URL per language)
// ---------------------------------------------------------------------------

export async function get_route_map(): Promise<Record<string, Record<string, string>>> {
	const translations = await load_all_translations(PUBLIC_DIR, languages);
	const page_files = without_draft_pages(collect_page_files(PUBLIC_DIR, languages));
	const route_map = build_static_route_map(translations, page_files, languages);

	const out: Record<string, Record<string, string>> = {};
	for (const [canonical, per_lang] of route_map) {
		const urls: Record<string, string> = {};
		for (const [lang, localized] of per_lang) {
			const prefix = lang === default_language ? "" : `/${lang}`;
			urls[lang] = localized === "/" ? (prefix || "/") : `${prefix}${localized}`;
		}
		out[canonical] = urls;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Page detail
// ---------------------------------------------------------------------------

export async function get_page_detail(route: string): Promise<Record<string, any>> {
	const pages = list_pages();
	const normalized = route.startsWith("/") ? route : `/${route}`;
	const page = pages.find((p) => p.route === normalized || p.path === route);
	if (!page) {
		throw new Error(`No page found for "${route}". Use list_pages to see available routes.`);
	}

	// The collapsed base path may not exist on disk when only language variants
	// do - read frontmatter from the first real file.
	const first_file = page.files[0];
	const frontmatter = first_file ? read_frontmatter(join(PUBLIC_DIR, first_file)) : {};

	const paginated = pagination.enabled && pagination.routes.some((r) => `/${r.route.replace(
		/^\/+|\/+$/g,
		""
	)}` === page.route);
	const localized_urls = (await get_route_map())[page.route] ?? {};

	return { ...page, frontmatter, paginated, localized_urls };
}

// ---------------------------------------------------------------------------
// Translations (per-language JSON files under src/public)
// ---------------------------------------------------------------------------

export async function list_translation_namespaces(): Promise<Record<string, string[]>> {
	const translations = await load_all_translations(PUBLIC_DIR, languages);
	const out: Record<string, string[]> = {};
	for (const lang of languages) {
		out[lang] = Object.keys(translations[lang] ?? {}).sort();
	}
	return out;
}

export async function get_translations_for(lang: string, namespace?: string): Promise<Record<string, any>> {
	if (!(languages as readonly string[]).includes(lang)) {
		throw new Error(`Unknown language "${lang}". Configured languages: ${languages.join(", ")}`);
	}

	const translations = await load_all_translations(PUBLIC_DIR, languages);
	const tree = translations[lang] ?? {};
	if (!namespace) { return tree; }

	let current: any = tree;
	for (const part of namespace.split(".")) {
		if (!current || typeof current !== "object" || !(part in current)) {
			throw new Error(`Namespace "${namespace}" not found for language "${lang}"`);
		}
		current = current[part];
	}
	return current;
}

// ---------------------------------------------------------------------------
// Config / project info
// ---------------------------------------------------------------------------

export async function get_project_config(): Promise<Record<string, any>> {
	const namespaces = await list_translation_namespaces();

	return {
		project: {
			name: pkg_json.name,
			version: pkg_json.version,
			description: pkg_json.description,
		},
		languages: {
			all: languages,
			active: active_languages,
			soft_launch: soft_launch_languages,
			default: default_language,
			names: language_names,
			locales: language_locales,
		},
		pagination: {
			enabled: pagination.enabled,
			per_page: pagination.per_page,
			path_segment: pagination.path_segment,
			variant: pagination.variant,
			routes: pagination.routes,
		},
		redirects: redirects.length,
		pages: list_pages().length,
		components: list_components().length,
		translation_namespaces: namespaces,
		source_dir: "src/public",
		output_dir: "dist",
	};
}

// ---------------------------------------------------------------------------
// Read project files
// ---------------------------------------------------------------------------

export async function read_project_file(filePath: string): Promise<string | null> {
	const absPath = join(PROJECT_ROOT, filePath);
	if (!existsSync(absPath)) return null;
	return await file(absPath).text();
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function list_components(): string[] {
	if (!existsSync(COMPONENTS_DIR)) return [];
	const entries = readdirSync(COMPONENTS_DIR, { withFileTypes: true });
	return entries.filter((e) => e.isFile() && e.name.endsWith(".ree")).map((e) => e.name.replace(
		/\.ree$/,
		""
	));
}

// ---------------------------------------------------------------------------
// Template analysis
// ---------------------------------------------------------------------------

export function analyze_template(tpl: string): Record<string, any> {
	const result: Record<string, any> = {
		layout: null,
		includes: [],
		components: [],
		variables: new Set(),
		translation_keys: new Set(),
		conditionals: 0,
		loops: 0,
		hasElse: false,
	};

	const layoutMatch = tpl.match(/\{#layout\(['"]([^'"]+)['"]/);
	if (layoutMatch) result.layout = layoutMatch[1];

	const includeRegex = /\{#include\(['"]([^'"]+)['"]/g;
	let m;
	while ((m = includeRegex.exec(tpl)) !== null) {
		const include = m[1] as string;
		if (!include.startsWith("$components/")) { result.includes.push(include); }
	}

	const compRegex = /<([a-zA-Z][a-zA-Z0-9]*-[a-zA-Z0-9-]*)\b/g;
	while ((m = compRegex.exec(tpl)) !== null) {
		result.components.push(m[1]);
	}

	const ifRegex = /\{#if\s+/g;
	while (ifRegex.exec(tpl) !== null) result.conditionals++;
	const elseRegex = /\{:else\s*\}/g;
	while (elseRegex.exec(tpl) !== null) result.hasElse = true;

	const eachRegex = /\{#each\s+/g;
	while (eachRegex.exec(tpl) !== null) result.loops++;

	const varRegex = /\{[=~]\s*([\w.]+(?:\.[\w]+)*)\s*\}/g;
	while ((m = varRegex.exec(tpl)) !== null) {
		const ref = m[1] as string;
		if (!ref.includes("(")) {
			const parts = ref.split(".");
			if (parts[0] !== "helpers" && parts[0] !== "props") { result.variables.add(parts[0]); }
		}
	}

	// Translation lookup tags: {_ path } (escaped), {- path } (raw), {@ path } (markdown).
	const trRegex = /\{[_@-]\s*([\w.]+)\s*\}/g;
	while ((m = trRegex.exec(tpl)) !== null) {
		result.translation_keys.add(m[1]);
	}

	const propsVarRegex = /\bprops\.([\w]+)\b/g;
	while ((m = propsVarRegex.exec(tpl)) !== null) {
		result.variables.add(`props.${m[1]}`);
	}

	result.variables = [...result.variables].sort();
	result.translation_keys = [...result.translation_keys].sort();
	return result;
}

// ---------------------------------------------------------------------------
// Code search
// ---------------------------------------------------------------------------

export async function search_code(pattern: string, glob?: string, maxResults = 50): Promise<{ matches: Array<{ file: string; line: number; content: string; }>; total: number; }> {
	const matches: Array<{ file: string; line: number; content: string; }> = [];
	let total = 0;

	const args = build_code_search_args(pattern, glob);
	const result = spawnSync(["rg", ...args]);

	if (result.exitCode !== 0 && result.exitCode !== 1) {
		throw new Error(`ripgrep exited with code ${result.exitCode}`);
	}

	const stdout = result.stdout.toString();
	const lines = stdout.split("\n").filter(Boolean);

	for (const line of lines) {
		if (total >= maxResults) break;
		const sepIndex = line.indexOf(":");
		if (sepIndex < 0) continue;
		const file = line.slice(0, sepIndex);
		const rest = line.slice(sepIndex + 1);
		const lineSepIndex = rest.indexOf(":");
		const lineNum = parseInt(rest.slice(0, lineSepIndex), 10);
		const content = rest.slice(lineSepIndex + 1);
		if (!Number.isNaN(lineNum)) {
			matches.push({ file: file.replace(`${PROJECT_ROOT}/`, ""), line: lineNum, content });
			total++;
		}
	}

	return { matches, total: matches.length };
}
