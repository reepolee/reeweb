/**
 * scripts/ssg/collections.ts
 *
 * Content collections: build-time frontmatter validation. A folder is a
 * collection when it contains a `_schema.ts` exporting a Zod `schema`; its
 * presence auto-registers the collection.
 *
 * `validate_entries` is the pure core (reads files, no console, no exit) so
 * it can be unit-tested with a fixture folder + schema. `validate_collections`
 * is the build-time driver: it discovers schema files, imports them, and runs
 * the validator across every entry, leaving the report/exit decision to the
 * caller.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

import { route_record_files } from "$lib/collect_records";
import { parse_frontmatter } from "$lib/static_site";

import type { CollectionIssue } from "./types";

/**
 * Validate a collection's entry files against a Zod schema.
 *
 * Each entry's frontmatter is checked with `schema.safeParse`; every issue is
 * collected (not just the first). Caller supplies the entry file list (see
 * `route_record_files`, which already excludes a collection's listing index and
 * keeps folder-per-post entries) and is responsible for reporting + exiting.
 */
export function validate_entries(schema: {
	safeParse: (data: unknown) => {
		success: boolean;
		error?: { issues: Array<{ path: PropertyKey[]; message: string; }>; };
	};
}, entry_files: string[], public_dir: string): CollectionIssue[] {
	const issues: CollectionIssue[] = [];

	for (const rel of entry_files) {
		const text = readFileSync(join(public_dir, rel), "utf-8");
		const { data } = parse_frontmatter(text);
		const result = schema.safeParse(data);

		if (!result.success && result.error) {
			for (const issue of result.error.issues) {
				const field = issue.path.length > 0 ? String(issue.path[0]) : "(root)";
				issues.push({ file: rel, field, message: issue.message });
			}
		}
	}

	return issues;
}

/** Find every `_schema.ts` in the walked file list (root-level or nested). */
export function find_schema_files(all_files: string[]): string[] {
	return all_files.filter((rel) => rel === "_schema.ts" || rel.endsWith("/_schema.ts"));
}

/**
 * Discover content collections, import their schemas, and validate every
 * entry. Returns the aggregated issues (empty when all valid). Logs per-
 * collection progress; the caller decides whether to fail the build.
 */
export async function validate_collections(all_files: string[], public_dir: string): Promise<CollectionIssue[]> {
	const schema_files = find_schema_files(all_files);
	if (schema_files.length === 0) return [];

	console.log("🔎 Validating content collections...");
	const collection_issues: CollectionIssue[] = [];

	for (const schema_rel of schema_files) {
		const collection_dir = schema_rel.replace(/\/?_schema\.ts$/, ""); // "" = public root
		const schema_full = join(public_dir, schema_rel);
		const schema_url = pathToFileURL(schema_full).href;
		const schema_module = await import(schema_url);

		if (!schema_module.schema || typeof schema_module.schema.safeParse !== "function") {
			console.warn(`    ⚠  ${schema_rel} does not export a Zod \`schema\` - skipping`);
			continue;
		}

		const entry_files = route_record_files(collection_dir, all_files);
		const issues = validate_entries(schema_module.schema, entry_files, public_dir);
		collection_issues.push(...issues);

		console.log(
			`    ✓ ${collection_dir || "(root)"}: ${entry_files.length} entr(y/ies) checked`
		);
	}

	return collection_issues;
}
