#!/usr/bin/env bun
/**
 * MCP Server - translation maintenance.
 *
 * Reeweb stores translations in per-language JSON files: src/public/{lang}.json
 * is the global "routes" bundle; a folder's {lang}.json overlays that folder's
 * pages. Templates reference keys with {_ key} (escaped), {- key} (raw), and
 * {@ key} (markdown).
 *
 * This module works on the RAW files (load_all_translations back-fills missing
 * keys across languages, which would hide exactly the gaps we report):
 *   - check:  cross-language key diff, template keys missing everywhere,
 *             authored keys no template references (report-only)
 *   - write:  upsert entries into the owning {lang}.json (indent-preserving,
 *             mirrors scripts/dev/i18n_write.ts behavior)
 *   - add/remove a language: config/supported_languages.ts + JSON files
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { default_language, languages } from "$config/supported_languages";
import { walk_dir } from "$lib/static_site";

import { assert_mcp_mutation_enabled } from "./capabilities";
import { PROJECT_ROOT, PUBLIC_DIR } from "./paths";

const CONFIG_FILE = join(PROJECT_ROOT, "config", "supported_languages.ts");

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Extract translation keys referenced via {_ key}, {- key}, {@ key} tags. */
export function extract_translation_keys(template: string): string[] {
	const keys = new Set<string>();
	const tag_re = /\{[_@-]\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g;
	let m;
	while ((m = tag_re.exec(template)) !== null) {
		keys.add(m[1] as string);
	}
	return [...keys].sort();
}

/** Flatten a translation tree into dotted leaf-key paths. */
export function flatten_leaf_paths(tree: any, prefix = ""): string[] {
	const out: string[] = [];
	for (const key of Object.keys(tree ?? {})) {
		const val = tree[key];
		const path = prefix ? `${prefix}.${key}` : key;
		if (val && typeof val === "object" && !Array.isArray(val)) {
			out.push(...flatten_leaf_paths(val, path));
		} else {
			out.push(path);
		}
	}
	return out;
}

function is_route_name(key: string): boolean {
	return key === "route_name" || key.endsWith(".route_name");
}

/** Per-language missing keys against the union of all languages' keys. */
export function diff_language_keys(keys_by_lang: Record<string, string[]>, langs: readonly string[]): Record<string, string[]> {
	const union = new Set<string>();
	for (const lang of langs) {
		for (const key of keys_by_lang[lang] ?? []) union.add(key);
	}

	const out: Record<string, string[]> = {};
	for (const lang of langs) {
		const have = new Set(keys_by_lang[lang] ?? []);
		const missing = [...union].filter((key) => !have.has(key) && !is_route_name(key)).sort();
		if (missing.length > 0) out[lang] = missing;
	}
	return out;
}

/** Recursively drop route_name keys (they must never be inherited across languages). */
export function strip_route_names(tree: any): any {
	if (!tree || typeof tree !== "object" || Array.isArray(tree)) return tree;
	const out: Record<string, any> = {};
	for (const key of Object.keys(tree)) {
		if (key === "route_name") continue;
		out[key] = strip_route_names(tree[key]);
	}
	return out;
}

/** Set a dotted key, creating intermediate objects (mirrors dev i18n_write). */
function set_dotted(obj: Record<string, any>, key: string, value: string): void {
	const parts = key.split(".");
	let cursor: Record<string, any> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i] as string;
		if (cursor[part] == null || typeof cursor[part] !== "object") cursor[part] = {};
		cursor = cursor[part];
	}
	cursor[parts[parts.length - 1] as string] = value;
}

/** Detect the indent unit used by the file (mirrors dev i18n_write). */
function detect_indent(raw_text: string): string {
	const match = raw_text.match(/\n([\t ]+)\S/);
	if (!match) return "\t";
	return (match[1] as string)[0] === "\t" ? "\t" : (match[1] as string);
}

// ---------------------------------------------------------------------------
// Translation file inventory
// ---------------------------------------------------------------------------

export type TranslationGroup = {
	/** Folder relative to src/public; "" for the root (global "routes") bundle. */
	dir: string;
	/** Lang → dotted leaf-key paths in that language's raw file. */
	keys_by_lang: Record<string, string[]>;
};

function collect_translation_groups(langs: readonly string[]): TranslationGroup[] {
	const lang_set = new Set(langs);
	const by_dir = new Map<string, Record<string, string[]>>();

	for (const rel of walk_dir(PUBLIC_DIR)) {
		if (!rel.endsWith(".json")) continue;
		const lang = rel.slice(rel.lastIndexOf("/") + 1).replace(".json", "");
		if (!lang_set.has(lang)) continue;

		const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
		const json = JSON.parse(readFileSync(join(PUBLIC_DIR, rel), "utf-8"));
		const group = by_dir.get(dir) ?? {};
		group[lang] = flatten_leaf_paths(json);
		by_dir.set(dir, group);
	}

	return [...by_dir.entries()].map(([dir, keys_by_lang]) => ({ dir, keys_by_lang })).sort((a, b) => a.dir.localeCompare(
		b.dir
	));
}

// ---------------------------------------------------------------------------
// check_translations (read-only report)
// ---------------------------------------------------------------------------

export async function check_translations(): Promise<Record<string, any>> {
	const groups = collect_translation_groups(languages);
	const root_group = groups.find((g) => g.dir === "");

	// 1. Cross-language diff per translation folder.
	const key_diff: Record<string, Record<string, string[]>> = {};
	for (const group of groups) {
		const diff = diff_language_keys(group.keys_by_lang, languages);
		if (Object.keys(diff).length > 0) { key_diff[group.dir || "(root)"] = diff; }
	}

	// 2. Referenced keys: every .ree/.md under src/public and src/components.
	const union_keys = (group?: TranslationGroup): Set<string> => {
		const out = new Set<string>();
		for (const lang of languages) {
			for (const key of group?.keys_by_lang[lang] ?? []) out.add(key);
		}
		return out;
	};
	const root_keys = union_keys(root_group);
	const group_keys = new Map(groups.map((g) => [g.dir, union_keys(g)]));

	const has_key = (keys: Set<string>, key: string): boolean => {
		if (keys.has(key)) return true;
		const prefix = `${key}.`;
		for (const k of keys) {
			if (k.startsWith(prefix)) return true;
		}
		return false;
	};

	const referenced = new Set<string>();
	const missing: Array<{ key: string; file: string; }> = [];
	const template_files = [
		...walk_dir(PUBLIC_DIR).filter((f) => f.endsWith(".ree") || f.endsWith(".md")).map((f) => ({
			rel: f,
			abs: join(PUBLIC_DIR, f),
			dir: f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "",
		})),
		...(existsSync(join(PROJECT_ROOT, "src", "components")) ? walk_dir(join(
			PROJECT_ROOT,
			"src",
			"components"
		)).filter((f) => f.endsWith(".ree")).map((f) => ({
			rel: `../components/${f}`,
			abs: join(PROJECT_ROOT, "src", "components", f),
			dir: null as string | null,
		})) : []),
	];

	for (const file of template_files) {
		for (const key of extract_translation_keys(readFileSync(file.abs, "utf-8"))) {
			referenced.add(key);

			// A page key resolves against its folder's overlay, then the root
			// bundle. Components have no fixed namespace: check every group.
			const found = file.dir === null ? groups.some((g) => has_key(union_keys(g), key)) : has_key(group_keys.get(
				file.dir
			) ?? new Set(), key) || has_key(root_keys, key);
			if (!found) { missing.push({ key, file: file.rel }); }
		}
	}

	// 3. Orphans: authored leaf keys never referenced (exact, ancestor, or
	// descendant). route_name and the language-switcher names are structural.
	const orphans: Record<string, string[]> = {};
	const is_referenced = (key: string): boolean => {
		if (referenced.has(key)) return true;
		for (const r of referenced) {
			if (r.startsWith(`${key}.`) || key.startsWith(`${r}.`)) return true;
		}
		return false;
	};
	for (const group of groups) {
		const orphan_keys = [...union_keys(group)].filter((key) => !is_route_name(key) && !(group.dir === "" && key.startsWith(
			"ui.language_names"
		)) && !is_referenced(key)).sort();
		if (orphan_keys.length > 0) { orphans[group.dir || "(root)"] = orphan_keys; }
	}

	return {
		languages,
		stats: {
			translation_folders: groups.length,
			templates_scanned: template_files.length,
			referenced_keys: referenced.size,
			missing: missing.length,
			orphans: Object.values(orphans).flat().length,
		},
		key_diff,
		missing_everywhere: missing,
		orphans,
		note: "Report only - nothing was changed. Orphans may be false positives when keys are read from code or built dynamically. Fix gaps with set_translations.",
	};
}

// ---------------------------------------------------------------------------
// set_translations (mutation)
// ---------------------------------------------------------------------------

export type TranslationEntry = { lang: string; namespace: string; key_path: string; value: string; };

export async function set_translations(entries: TranslationEntry[]): Promise<Record<string, any>> {
	assert_mcp_mutation_enabled();

	const written: string[] = [];
	const created_files: string[] = [];

	for (const entry of entries) {
		if (!(languages as readonly string[]).includes(entry.lang)) {
			throw new Error(`Unknown language "${entry.lang}". Configured: ${languages.join(", ")}`);
		}
		const ns = entry.namespace.replace(/^\/+|\/+$/g, "");
		if (ns.split("/").some((s) => s === "..") || ns.includes("\\")) {
			throw new Error(`Invalid namespace "${entry.namespace}"`);
		}

		const dir = ns ? join(PUBLIC_DIR, ns) : PUBLIC_DIR;
		if (!existsSync(dir)) { throw new Error(`Namespace folder does not exist: src/public/${ns}`); }

		const file_path = join(dir, `${entry.lang}.json`);
		const existing_text = existsSync(file_path) ? readFileSync(file_path, "utf-8") : "";
		if (!existing_text) { created_files.push(file_path.replace(`${PROJECT_ROOT}/`, "")); }

		const json = existing_text ? JSON.parse(existing_text) : {};
		set_dotted(json, entry.key_path, entry.value);

		const indent = existing_text ? detect_indent(existing_text) : "\t";
		await Bun.write(file_path, `${JSON.stringify(json, null, indent)}\n`);
		written.push(`${entry.lang}:${ns ? `${ns}/` : ""}${entry.key_path}`);
	}

	return {
		written: written.length,
		created_files,
		entries: written,
		note: "The dev server hot-reloads translation JSON; rebuild with run_ssg for dist/.",
	};
}

// ---------------------------------------------------------------------------
// add_language / remove_language (mutation)
// ---------------------------------------------------------------------------

/**
 * Whether the config file currently registers the language. Checked against
 * the file, not the imported constant - the import is stale after an
 * add/remove in the same server process.
 */
function config_has_language(lang: string): boolean {
	const text = readFileSync(CONFIG_FILE, "utf-8");
	const match = text.match(/export const languages = \[([^\]]*)\]/);
	return !!match && new RegExp(`"${lang}"`).test(match[1] as string);
}

function update_language_config(action: "add" | "remove", lang: string, name?: string, locale?: string): void {
	let text = readFileSync(CONFIG_FILE, "utf-8");
	const before = text;

	if (action === "add") {
		const key = lang.includes("-") ? `"${lang}"` : lang;
		text = text.replace(/(export const languages = \[[^\]]*?)\s*(\])/, `$1, "${lang}"$2`);
		text = text.replace(/(export const active_languages = \[[^\]]*?)\s*(\])/, `$1, "${lang}"$2`);
		text = text.replace(
			/(export const language_names[^=]*=\s*\{[^}]*?)\s*(\})/,
			`$1, ${key}: "${name ?? lang}" $2`
		);
		text = text.replace(
			/(export const language_locales[^=]*=\s*\{[^}]*?)\s*(\})/,
			`$1, ${key}: "${locale ?? lang}" $2`
		);
	} else {
		text = text.replace(new RegExp(`\\s*,\\s*"${lang}"|"${lang}",\\s*`, "g"), "");
		text = text.replace(new RegExp(
			`\\s*,\\s*"?${lang}"?:\\s*"[^"]*"|"?${lang}"?:\\s*"[^"]*",\\s*`,
			"g",
		), "");
	}

	if (text === before) {
		throw new Error(
			`config/supported_languages.ts did not match the expected shape - edit it manually for "${lang}"`,
		);
	}
	Bun.write(CONFIG_FILE, text);
}

export async function add_language(lang: string, name?: string, locale?: string): Promise<Record<string, any>> {
	assert_mcp_mutation_enabled();
	if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(lang)) { throw new Error(`Invalid language code "${lang}"`); }
	if (config_has_language(lang)) { throw new Error(`Language "${lang}" is already configured`); }

	update_language_config("add", lang, name, locale);

	// Seed a {lang}.json next to every default-language file, values copied
	// from the default language (pages render immediately; translate the copies
	// with set_translations). route_name is stripped - slugs stay unlocalized
	// until explicitly translated.
	const created: string[] = [];
	for (const rel of walk_dir(PUBLIC_DIR)) {
		if (!rel.endsWith(`/${default_language}.json`) && rel !== `${default_language}.json`) continue;

		const target_rel = rel.replace(new RegExp(`${default_language}\\.json$`), `${lang}.json`);
		const target_abs = join(PUBLIC_DIR, target_rel);
		if (existsSync(target_abs)) continue;

		const source_text = readFileSync(join(PUBLIC_DIR, rel), "utf-8");
		const seeded = strip_route_names(JSON.parse(source_text));
		await Bun.write(target_abs, `${JSON.stringify(seeded, null, detect_indent(source_text))}\n`);
		created.push(`src/public/${target_rel}`);
	}

	return {
		lang,
		config_updated: "config/supported_languages.ts",
		created_files: created,
		next_steps: "Translate the seeded copies with set_translations (add route_name keys for localized slugs). Reconnect the MCP server so the new language is picked up.",
	};
}

export async function remove_language(lang: string): Promise<Record<string, any>> {
	assert_mcp_mutation_enabled();
	if (lang === default_language) {
		throw new Error(`"${lang}" is the default language - change default_language first`);
	}
	if (!config_has_language(lang)) { throw new Error(`Language "${lang}" is not configured`); }

	update_language_config("remove", lang);

	const deleted: string[] = [];
	const leftover_templates: string[] = [];
	for (const rel of walk_dir(PUBLIC_DIR)) {
		if (rel === `${lang}.json` || rel.endsWith(`/${lang}.json`)) {
			rmSync(join(PUBLIC_DIR, rel));
			deleted.push(`src/public/${rel}`);
		}
		if (rel.endsWith(`.${lang}.ree`) || rel.endsWith(`.${lang}.md`)) {
			leftover_templates.push(`src/public/${rel}`);
		}
	}

	return {
		lang,
		config_updated: "config/supported_languages.ts",
		deleted_files: deleted,
		leftover_variant_templates: leftover_templates,
		note: "Language-variant templates were left in place - delete them manually if no longer needed. Reconnect the MCP server to refresh the language list.",
	};
}
