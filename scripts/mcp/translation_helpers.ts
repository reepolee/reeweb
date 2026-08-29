/**
 * Pure translation-key helpers for the MCP translation tools. No I/O - every
 * function here is unit-testable in isolation.
 *
 * Reeweb stores translations in per-locale JSON files: src/public/{locale}.json
 * (lowercase BCP 47, e.g. "en-us.json") is the global "routes" bundle; a folder's
 * {locale}.json overlays that folder's pages. Templates reference keys with
 * {_ key} (escaped), {- key} (raw), and {@ key} (markdown).
 */

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

/** route_name keys are structural (localized slugs) - never treated as gaps or orphans. */
export function is_route_name(key: string): boolean {
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
export function set_dotted(obj: Record<string, any>, key: string, value: string): void {
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
export function detect_indent(raw_text: string): string {
	const match = raw_text.match(/\n([\t ]+)\S/);
	if (!match) return "\t";
	return (match[1] as string)[0] === "\t" ? "\t" : (match[1] as string);
}
