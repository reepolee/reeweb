#!/usr/bin/env bun
/**
 * MCP Server - translation maintenance.
 *
 * Reeweb stores translations in per-locale JSON files: src/public/{locale}.json
 * (lowercase BCP 47, e.g. "en-us.json") is the global "routes" bundle; a folder's
 * {locale}.json overlays that folder's pages. Templates reference keys with
 * {_ key} (escaped), {- key} (raw), and {@ key} (markdown).
 *
 * This module works on the RAW files (load_all_translations back-fills missing
 * keys across locales, which would hide exactly the gaps we report):
 *   - check:  cross-locale key diff, template keys missing everywhere,
 *             authored keys no template references (report-only)
 *   - write:  upsert entries into the owning {locale}.json (indent-preserving,
 *             mirrors scripts/dev/i18n_write.ts behavior)
 *   - add/remove a locale: config/supported_locales.ts + JSON files
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { default_locale, locales } from "$config/supported_locales";
import { walk_dir } from "$lib/static_site";

import { assert_mcp_mutation_enabled } from "./capabilities";
import { PROJECT_ROOT, PUBLIC_DIR } from "./paths";

const CONFIG_FILE = join(PROJECT_ROOT, "config", "supported_locales.ts");

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

/** Per-locale missing keys against the union of all locales' keys. */
export function diff_locale_keys(keys_by_locale: Record<string, string[]>, locales: readonly string[]): Record<string, string[]> {
	const union = new Set<string>();
	for (const locale of locales) {
		for (const key of keys_by_locale[locale] ?? []) union.add(key);
	}

	const out: Record<string, string[]> = {};
	for (const locale of locales) {
		const have = new Set(keys_by_locale[locale] ?? []);
		const missing = [...union].filter((key) => !have.has(key) && !is_route_name(key)).sort();
		if (missing.length > 0) out[locale] = missing;
	}
	return out;
}

/** Recursively drop route_name keys (they must never be inherited across locales). */
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
	/** Locale → dotted leaf-key paths in that locale's raw file. */
	keys_by_locale: Record<string, string[]>;
};

function collect_translation_groups(locale_list: readonly string[]): TranslationGroup[] {
	const locale_set = new Set(locale_list);
	const by_dir = new Map<string, Record<string, string[]>>();

	for (const rel of walk_dir(PUBLIC_DIR)) {
		if (!rel.endsWith(".json")) continue;
		const locale = rel.slice(rel.lastIndexOf("/") + 1).replace(".json", "");
		if (!locale_set.has(locale)) continue;

		const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
		const json = JSON.parse(readFileSync(join(PUBLIC_DIR, rel), "utf-8"));
		const group = by_dir.get(dir) ?? {};
		group[locale] = flatten_leaf_paths(json);
		by_dir.set(dir, group);
	}

	return [...by_dir.entries()].map(([dir, keys_by_locale]) => ({ dir, keys_by_locale })).sort((a, b) => a.dir.localeCompare(
		b.dir
	));
}

// ---------------------------------------------------------------------------
// check_translations (read-only report)
// ---------------------------------------------------------------------------

export async function check_translations(): Promise<Record<string, any>> {
	const groups = collect_translation_groups(locales);
	const root_group = groups.find((g) => g.dir === "");

	// 1. Cross-locale diff per translation folder.
	const key_diff: Record<string, Record<string, string[]>> = {};
	for (const group of groups) {
		const diff = diff_locale_keys(group.keys_by_locale, locales);
		if (Object.keys(diff).length > 0) { key_diff[group.dir || "(root)"] = diff; }
	}

	// 2. Referenced keys: every .ree/.md under src/public and src/components.
	const union_keys = (group?: TranslationGroup): Set<string> => {
		const out = new Set<string>();
		for (const locale of locales) {
			for (const key of group?.keys_by_locale[locale] ?? []) out.add(key);
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
	// descendant). route_name and the locale-switcher names are structural.
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
		locales,
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

export type TranslationEntry = { locale: string; namespace: string; key_path: string; value: string; };

export async function set_translations(entries: TranslationEntry[]): Promise<Record<string, any>> {
	assert_mcp_mutation_enabled();

	const written: string[] = [];
	const created_files: string[] = [];

	for (const entry of entries) {
		if (!(locales as readonly string[]).includes(entry.locale)) {
			throw new Error(`Unknown locale "${entry.locale}". Configured: ${locales.join(", ")}`);
		}
		const ns = entry.namespace.replace(/^\/+|\/+$/g, "");
		if (ns.split("/").some((s) => s === "..") || ns.includes("\\")) {
			throw new Error(`Invalid namespace "${entry.namespace}"`);
		}

		const dir = ns ? join(PUBLIC_DIR, ns) : PUBLIC_DIR;
		if (!existsSync(dir)) { throw new Error(`Namespace folder does not exist: src/public/${ns}`); }

		const file_path = join(dir, `${entry.locale}.json`);
		const existing_text = existsSync(file_path) ? readFileSync(file_path, "utf-8") : "";
		if (!existing_text) { created_files.push(file_path.replace(`${PROJECT_ROOT}/`, "")); }

		const json = existing_text ? JSON.parse(existing_text) : {};
		set_dotted(json, entry.key_path, entry.value);

		const indent = existing_text ? detect_indent(existing_text) : "\t";
		await Bun.write(file_path, `${JSON.stringify(json, null, indent)}\n`);
		written.push(`${entry.locale}:${ns ? `${ns}/` : ""}${entry.key_path}`);
	}

	return {
		written: written.length,
		created_files,
		entries: written,
		note: "The dev server hot-reloads translation JSON; rebuild with run_ssg for dist/.",
	};
}

// ---------------------------------------------------------------------------
// add_locale / remove_locale (mutation)
// ---------------------------------------------------------------------------

/**
 * Whether the config file currently registers the locale. Checked against
 * the file, not the imported constant - the import is stale after an
 * add/remove in the same server process.
 */
function config_has_locale(locale: string): boolean {
	const text = readFileSync(CONFIG_FILE, "utf-8");
	const match = text.match(/export const locales = \[([^\]]*)\]/);
	return !!match && new RegExp(`"${locale}"`).test(match[1] as string);
}

/**
 * Rewrite config/supported_locales.ts for an add/remove.
 *
 * The old config shape had a `language_locales` lookup table mapping a short
 * language code to its BCP 47 locale (e.g. { en: "en-us" }) - that table no
 * longer exists because `locale` (the lowercase BCP 47 code itself, e.g.
 * "en-us") IS the single localization axis now. Adding a locale is therefore just:
 * append it to `locales` and `active_locales`, and add its display name to
 * `locale_names`. An optional `alias_target` instead adds a `locale_aliases`
 * entry (the new locale shares an existing locale's UI-string translations,
 * per src/lib/locale.ts's resolve_ui_locale) - used for a locale that should
 * route/build independently but not yet have its own translated strings.
 */
function update_locale_config(action: "add" | "remove", locale: string, name?: string, alias_target?: string): void {
	let text = readFileSync(CONFIG_FILE, "utf-8");
	const before = text;

	if (action === "add") {
		text = text.replace(/(export const locales = \[[^\]]*?)\s*(\])/, `$1, "${locale}"$2`);
		text = text.replace(/(export const active_locales = \[[^\]]*?)\s*(\])/, `$1, "${locale}"$2`);
		text = text.replace(
			/(export const locale_names[^=]*=\s*\{[^}]*?)\s*(\})/,
			`$1, "${locale}": "${name ?? locale}" $2`
		);
		if (alias_target) {
			text = text.replace(
				/(export const locale_aliases[^=]*=\s*\{[^}]*?)\s*(\})/,
				`$1, "${locale}": "${alias_target}" $2`
			);
		}
	} else {
		text = text.replace(new RegExp(`\\s*,\\s*"${locale}"|"${locale}",\\s*`, "gi"), "");
		text = text.replace(new RegExp(
			`\\s*,\\s*"?${locale}"?:\\s*"[^"]*"|"?${locale}"?:\\s*"[^"]*",\\s*`,
			"gi",
		), "");
	}

	if (text === before) {
		throw new Error(
			`config/supported_locales.ts did not match the expected shape - edit it manually for "${locale}"`,
		);
	}
	Bun.write(CONFIG_FILE, text);
}

export async function add_locale(raw_locale: string, name?: string, alias_target?: string): Promise<Record<string, any>> {
	assert_mcp_mutation_enabled();
	const locale = raw_locale.toLowerCase();
	if (!/^[a-z]{2,3}(-([a-z]{2,3}|[a-z]{4}|\d{3}))*$/.test(locale)) { throw new Error(`Invalid locale "${raw_locale}" - expected lowercase BCP 47 (e.g. "de-de")`); }
	if (config_has_locale(locale)) { throw new Error(`Locale "${locale}" is already configured`); }
	if (alias_target && !(locales as readonly string[]).includes(alias_target)) {
		throw new Error(`Unknown alias target "${alias_target}". Configured: ${locales.join(", ")}`);
	}

	update_locale_config("add", locale, name, alias_target);

	// Seed a {locale}.json next to every default-locale file, values copied
	// from the default locale (pages render immediately; translate the copies
	// with set_translations). route_name is stripped - slugs stay unlocalized
	// until explicitly translated. Skipped for an aliased locale - it serves
	// the alias target's translations and owns no file of its own.
	const created: string[] = [];
	if (!alias_target) {
		for (const rel of walk_dir(PUBLIC_DIR)) {
			if (!rel.endsWith(`/${default_locale}.json`) && rel !== `${default_locale}.json`) continue;

			const target_rel = rel.replace(new RegExp(`${default_locale}\\.json$`), `${locale}.json`);
			const target_abs = join(PUBLIC_DIR, target_rel);
			if (existsSync(target_abs)) continue;

			const source_text = readFileSync(join(PUBLIC_DIR, rel), "utf-8");
			const seeded = strip_route_names(JSON.parse(source_text));
			await Bun.write(target_abs, `${JSON.stringify(seeded, null, detect_indent(source_text))}\n`);
			created.push(`src/public/${target_rel}`);
		}
	}

	return {
		locale,
		config_updated: "config/supported_locales.ts",
		created_files: created,
		next_steps: alias_target ? `Locale "${locale}" aliases "${alias_target}" - it renders using that locale's translations, no seeded files. Reconnect the MCP server so the new locale is picked up.` : "Translate the seeded copies with set_translations (add route_name keys for localized slugs). Reconnect the MCP server so the new locale is picked up.",
	};
}

export async function remove_locale(locale: string): Promise<Record<string, any>> {
	assert_mcp_mutation_enabled();
	if (locale === default_locale) {
		throw new Error(`"${locale}" is the default locale - change default_locale first`);
	}
	if (!config_has_locale(locale)) { throw new Error(`Locale "${locale}" is not configured`); }

	update_locale_config("remove", locale);

	const deleted: string[] = [];
	const leftover_templates: string[] = [];
	for (const rel of walk_dir(PUBLIC_DIR)) {
		if (rel === `${locale}.json` || rel.endsWith(`/${locale}.json`)) {
			rmSync(join(PUBLIC_DIR, rel));
			deleted.push(`src/public/${rel}`);
		}
		if (rel.endsWith(`.${locale}.ree`) || rel.endsWith(`.${locale}.md`)) {
			leftover_templates.push(`src/public/${rel}`);
		}
	}

	return {
		locale,
		config_updated: "config/supported_locales.ts",
		deleted_files: deleted,
		leftover_variant_templates: leftover_templates,
		note: "Locale-variant templates were left in place - delete them manually if no longer needed. Reconnect the MCP server to refresh the locale list.",
	};
}
