/**
 * MCP translation tools - locale lifecycle (add/remove).
 *
 * Adding a locale rewrites config/supported_locales.ts and seeds a {locale}.json
 * next to every default-locale file; removing deletes the locale's JSON files
 * and unwires the config. Both are mutations gated by MCP_ENABLE_MUTATIONS=true.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { default_locale, locales } from "$config/supported_locales";
import { walk_dir } from "$lib/static_site";

import { assert_mcp_mutation_enabled } from "./capabilities";
import { PROJECT_ROOT, PUBLIC_DIR } from "./paths";
import { detect_indent, strip_route_names } from "./translation_helpers";

const CONFIG_FILE = join(PROJECT_ROOT, "config", "supported_locales.ts");

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
