#!/usr/bin/env bun
/**
 * Engine drift check.
 *
 * The .ree template engine (lib/template_engine.ts, lib/template/*, and the
 * engine test) is upstream code shared with the reepolee app template (a
 * sibling checkout, e.g. ../reepolee). reeweb's AGENTS.md says lib/ is upstream
 * and must not be edited here; this script enforces that as a checked
 * invariant instead of a convention.
 *
 * It compares the LOGIC of each shared file against the canonical copy,
 * tolerating comment and formatting differences (the two repos use different
 * reettier collapseSoftWidth settings, so byte/hash comparison is unusable).
 * Comparison is a "fingerprint": transpile away comments and types (string-
 * and regex-safe, unlike naive // stripping), collapse whitespace, and drop
 * trailing commas. Two files with identical behaviour produce equal
 * fingerprints regardless of comments or wrapping.
 *
 * Canonical repo lookup order: $REEPOLEE_DIR, then ../reepolee, then
 * ../reepolee. If none is found the check is skipped (exit 0) - not every
 * environment has the sibling checkout.
 *
 * Usage: bun run engine:check [--verbose|-v]
 */

import { existsSync } from "fs";
import { resolve, join } from "path";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";

function ok(msg: string) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}!${RESET} ${msg}`); }
function err(msg: string) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg: string) { console.log(`  ${DIM}~${RESET} ${msg}`); }

// Files shared verbatim (logic-wise) with the upstream reepolee engine.
// Relative to each repo's lib/ directory.
const SHARED_ENGINE_FILES = [
	"template_engine.ts",
	"template_engine.test.ts",
	"template/compiler.ts",
	"template/custom_elements.ts",
	"template/include_resolver.ts",
	"template/include_handler.ts",
	"template/types.ts",
];

const VERBOSE = Bun.argv.includes("--verbose") || Bun.argv.includes("-v");

const root = resolve(import.meta.dir, "..");

/** Locate the canonical (upstream) checkout, or null if none is present. */
function find_canonical_repo(): string | null {
	const candidates = [
		Bun.env.REEPOLEE_DIR,
		resolve(root, "..", "reepolee"),
		resolve(root, "..", "reepolee"),
	];
	for (const dir of candidates) {
		if (dir && existsSync(resolve(dir, "lib", "template_engine.ts"))) { return dir; }
	}
	return null;
}

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Logic fingerprint of a source file: comments and types removed (via the
 * transpiler, so `//` inside strings/regexes is safe), whitespace collapsed,
 * and trailing commas dropped. Identical behaviour => identical fingerprint.
 */
function fingerprint(source: string): string {
	const transpiled = transpiler.transformSync(source);
	const no_ws = transpiled.replace(/\s+/g, "");
	const no_trailing_commas = no_ws.replace(/,(?=[}\])])/g, "");
	return no_trailing_commas;
}

async function main() {
	const canonical = find_canonical_repo();
	if (!canonical) {
		info(
			"No canonical reepolee checkout found (set REEPOLEE_DIR or place ../reepolee). Skipping engine drift check."
		);
		process.exit(0);
	}

	console.log(`\n${BOLD}Engine drift check${RESET}  ${DIM}(canonical: ${canonical})${RESET}`);

	const drifted: string[] = [];
	const missing: string[] = [];
	const diff_sections: string[] = [];

	for (const rel of SHARED_ENGINE_FILES) {
		const local_path = resolve(root, "lib", rel);
		const canonical_path = resolve(canonical, "lib", rel);

		if (!existsSync(local_path) || !existsSync(canonical_path)) {
			missing.push(rel);
			err(`${rel}: missing (local: ${existsSync(local_path)}, canonical: ${existsSync(
				canonical_path
			)})`);
			continue;
		}

		const local_src = await Bun.file(local_path).text();
		const canonical_src = await Bun.file(canonical_path).text();

		const local_fp = fingerprint(local_src);
		const canonical_fp = fingerprint(canonical_src);

		if (local_fp === canonical_fp) {
			ok(`${rel}`);
		} else {
			drifted.push(rel);
			err(`${rel}: fingerprint differs from canonical (review diff for logic vs formatting)`);

			// Generate unified diff between canonical (a) and local (b) raw source.
			// This makes it actionable - you can see exactly what changed.
			// Note: raw source diff may include formatting/comment changes that
			// the fingerprint filter ignores - focus on logic-relevant lines.
			const result = Bun.spawnSync([
				"git",
				"diff",
				"--no-index",
				"--",
				canonical_path,
				local_path,
			], { cwd: root });
			const diff_ok = result.exitCode === 0 || result.exitCode === 1;
			const diff_text = diff_ok ? result.stdout.toString() : `(diff unavailable: ${(result.stderr.toString().trim()) || "exit code " + result.exitCode})\n`;

			// Collect for file output (with section header).
			diff_sections.push(`=== ${rel} ===\n\n${diff_text}\n`);

			if (VERBOSE) {
				info(`Diff (canonical ← local) for ${rel}:`);
				for (const line of diff_text.split("\n")) {
					console.log(`   ${DIM}${line}${RESET}`);
				}
			}
		}
	}

	console.log();
	if (drifted.length === 0 && missing.length === 0) {
		ok(`${SHARED_ENGINE_FILES.length} engine file(s) match canonical`);
		process.exit(0);
	}

	if (missing.length > 0) {
		warn(
			`${missing.length} file(s) missing on one side - the shared file set may have changed.`
		);
	}
	if (drifted.length > 0) {
		err(`${drifted.length} engine file(s) differ in fingerprint from canonical.`);
		info(
			"These files are upstream. Reconcile against the canonical copy; do not fork logic here."
		);
		info(
			"(Fingerprint strips whitespace, trailing commas, types, and comments - but some formatting may still slip through. Open the diff file to judge.)"
		);

		// Write all diffs to a file for easy IDE inspection.
		const diff_path = join(root, "engine_drift.diff");
		const header = [
			"# Engine Drift Report",
			"#",
			"# These diffs show raw source differences between local (reeweb) and canonical (reepolee).",
			"# Some files may appear here due to formatting/comment differences even if their",
			"# LOGIC FINGERPRINT matches (whitespace, trailing commas, and types are stripped;",
			"# comments are transpiled away). Review each diff for actual logic drift.",
			"# Files with same logic fingerprint: ✓",
			"#",
		].join("\n") + "\n\n";
		await Bun.write(diff_path, header + diff_sections.join("\n"));
		console.log();
		info(`Full diff written to ${diff_path}`);
		console.log();
	}
	process.exit(1);
}

main();
