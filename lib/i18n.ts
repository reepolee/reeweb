/**
 * lib/i18n.ts
 *
 * Translation loader for multi-locale support.
 * Walks a directory tree, discovers {locale}.json files (BCP 47, e.g.
 * "sl-si.json"), and assembles a nested translation object per locale with
 * cross-locale fallback.
 */

import { readdir } from "fs/promises";
import { relative, sep, join } from "path";

export async function load_all_translations(root_dir: string, locales: readonly string[]) {
	const translations: Record<string, any> = {};

	for (const locale of locales) {
		translations[locale] = {};
	}

	async function walk(dir: string) {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const full_path = join(dir, entry.name);

			if (entry.isDirectory()) {
				await walk(full_path);
				continue;
			}

			if (!entry.name.endsWith(".json")) continue;

			const locale_code = entry.name.replace(".json", "");
			if (!locales.includes(locale_code)) continue;

			// Proper relative path
			const rel = relative(root_dir, dir);

			// Split into namespace parts
			const namespace_parts = rel === "" ? ["routes"] : rel.split(sep).filter((p) => p !== "translations");

			const file = Bun.file(full_path);
			const json = await file.json();

			// Build nested structure
			let target = translations[locale_code];

			for (const part of namespace_parts) {
				if (!target[part]) target[part] = {};
				target = target[part];
			}

			Object.assign(target, json);
		}
	}

	function fill_missing(target: any, sources: any[]) {
		for (const source of sources) {
			for (const key of Object.keys(source || {})) {
				const val = source[key];

				// Never inherit route_name from other locales.
				if (key === "route_name") continue;

				if (typeof val === "object" && val !== null && !Array.isArray(val)) {
					if (!target[key] || typeof target[key] !== "object" || Array.isArray(
						target[key]
					) || Object.isFrozen(target[key])) { target[key] = {}; }
					fill_missing(target[key], sources.map((s) => s?.[key] || {}));
				} else {
					if (target[key] === undefined || target[key] === null || target[key] === "") {
						target[key] = val;
					}
				}
			}
		}
	}

	await walk(root_dir);

	const namespaces = new Set<string>();

	for (const locale of locales) {
		for (const ns of Object.keys(translations[locale])) {
			namespaces.add(ns);
		}
	}

	for (const ns of namespaces) {
		const locale_objs = locales.map((locale) => translations[locale][ns] || {});

		for (const locale of locales) {
			if (!translations[locale][ns]) translations[locale][ns] = {};
			fill_missing(translations[locale][ns], locale_objs);
		}
	}

	return translations;
}
