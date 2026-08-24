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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { locales } from "$config/supported_locales";
import { walk_dir } from "$lib/static_site";

import { assert_mcp_mutation_enabled } from "./capabilities";
import { PROJECT_ROOT, PUBLIC_DIR } from "./paths";
import {
	detect_indent,
	diff_locale_keys,
	extract_translation_keys,
	flatten_leaf_paths,
	is_route_name,
	set_dotted,
} from "./translation_helpers";

// Re-export the pure helpers so tests and callers keep one import path.
export {
	diff_locale_keys,
	extract_translation_keys,
	flatten_leaf_paths,
	strip_route_names,
} from "./translation_helpers";
export { add_locale, remove_locale } from "./locale_management";

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
