/**
 * scripts/dev/i18n_write.ts
 *
 * Dev-only translation write-back for the inspector. Given the page whose URL
 * was being viewed, the active language, a dotted key (e.g. "ui.welcome_title")
 * and a new value, resolve the physical {lang}.json file that owns the key and
 * write it back, creating the key if it only existed via cross-language
 * fallback.
 *
 * File resolution mirrors how load_all_translations assembles namespaces:
 *   - routes (global) strings live in the translations-root {lang}.json
 *     (public_dir/{lang}.json).
 *   - a page under a folder also has that folder's {lang}.json overlaid.
 * A key is looked up in the page's own namespace file first, then the routes
 * file. On a miss it is created in the namespace file when the page has one,
 * else the routes file - i.e. "edit on the /en/ page writes English".
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Candidate {lang}.json files for a page, most specific first. */
export function candidate_files(public_dir: string, page_rel_path: string, lang: string): string[] {
	const files: string[] = [];
	const page_dir = dirname(page_rel_path);
	if (page_dir && page_dir !== "." && page_dir !== "") {
		files.push(join(public_dir, page_dir, `${lang}.json`));
	}
	files.push(join(public_dir, `${lang}.json`));
	return files;
}

/** Read a dotted key from a plain object, or undefined if any segment is missing. */
function get_dotted(obj: Record<string, any>, key: string): unknown {
	const parts = key.split(".");
	let cursor: any = obj;
	for (const part of parts) {
		if (cursor == null || typeof cursor !== "object") return undefined;
		cursor = cursor[part];
	}
	return cursor;
}

/** Detect the indent unit ("\t" or N spaces) used by the first indented line. */
function detect_indent(raw_text: string): string {
	const match = raw_text.match(/\n([\t ]+)\S/);
	if (!match) return "\t";
	return (match[1] as string)[0] === "\t" ? "\t" : (match[1] as string);
}

/** Set a dotted key on a plain object, creating intermediate objects as needed. */
function set_dotted(obj: Record<string, any>, key: string, value: string): void {
	const parts = key.split(".");
	let cursor: Record<string, any> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i] as string;
		const next = cursor[part];
		if (next == null || typeof next !== "object") cursor[part] = {};
		cursor = cursor[part];
	}
	const last = parts[parts.length - 1] as string;
	cursor[last] = value;
}

export type I18nResolveResult = { ok: true; file: string; current: string | undefined; } | { ok: false; reason: string; };

/** Resolve which file a key should be read/written from, plus its current value. */
export function resolve_i18n_target(public_dir: string, page_rel_path: string, lang: string, key: string): I18nResolveResult {
	if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(key)) {
		return { ok: false, reason: `invalid key: ${key}` };
	}
	const candidates = candidate_files(public_dir, page_rel_path, lang);

	// Prefer a file that already defines the key; else the most specific existing
	// file (candidates[0] when a namespace file exists, else the routes file).
	let first_existing: string | null = null;
	for (const file of candidates) {
		if (!existsSync(file)) continue;
		if (first_existing === null) first_existing = file;
		const raw_text = readFileSync(file, "utf8");
		const json = JSON.parse(raw_text);
		const current = get_dotted(json, key);
		if (current !== undefined) {
			return {
				ok: true,
				file,
				current: typeof current === "string" ? current : String(current),
			};
		}
	}
	if (first_existing === null) return { ok: false, reason: `no ${lang}.json for this page` };
	return { ok: true, file: first_existing, current: undefined };
}

export type I18nWriteResult = { ok: true; file: string; } | { ok: false; reason: string; };

/** Write `value` at `key` into the resolved file, preserving all other keys. */
export async function write_i18n_value(
	public_dir: string,
	page_rel_path: string,
	lang: string,
	key: string,
	value: string,
): Promise<I18nWriteResult> {
	const resolved = resolve_i18n_target(public_dir, page_rel_path, lang, key);
	if (!resolved.ok) return { ok: false, reason: resolved.reason };

	const file = resolved.file;
	const existing_text = await Bun.file(file).text();
	const json = JSON.parse(existing_text);
	set_dotted(json, key, value);

	// Preserve the file's original indentation (tabs or N spaces) so a
	// single-key edit doesn't reformat the whole file into a full-file diff.
	const indent = detect_indent(existing_text);
	const serialized = JSON.stringify(json, null, indent) + "\n";
	await Bun.write(file, serialized);
	return { ok: true, file };
}
