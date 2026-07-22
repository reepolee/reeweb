#!/usr/bin/env bun
/**
 * Engine reconcile.
 *
 * Copies all shared engine files from the canonical reepolee checkout into
 * reeweb's lib/ directory, then runs reettier to apply local formatting.
 *
 * Use when engine:check reports drift - brings local copies back in sync
 * with upstream without losing reeweb's reettier style.
 *
 * Canonical repo lookup order: $REEPOLEE_DIR, then ../reepolee, then
 * ../reepolee. If none is found the script exits with an error.
 *
 * Usage: bun run reconcile
 */

import { existsSync, copyFileSync, mkdirSync } from "fs";
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

const SHARED_ENGINE_FILES = [
	"template_engine.ts",
	"template_engine.test.ts",
	"template/compiler.ts",
	"template/custom_elements.ts",
	"template/include_resolver.ts",
	"template/include_handler.ts",
];

const root = resolve(import.meta.dir, "..");

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

async function main() {
	const canonical = find_canonical_repo();
	if (!canonical) {
		err("No canonical reepolee checkout found (set REEPOLEE_DIR or place ../reepolee).");
		process.exit(1);
	}

	console.log(`\n${BOLD}Engine reconcile${RESET}  ${DIM}(canonical: ${canonical})${RESET}\n`);

	const copied: string[] = [];
	const errors: string[] = [];

	for (const rel of SHARED_ENGINE_FILES) {
		const local_path = resolve(root, "lib", rel);
		const canonical_path = resolve(canonical, "lib", rel);

		if (!existsSync(canonical_path)) {
			errors.push(`${rel}: canonical file not found at ${canonical_path}`);
			err(`${rel}: canonical file missing`);
			continue;
		}

		// Ensure the target directory exists
		const target_dir = join(local_path, "..");
		if (!existsSync(target_dir)) { mkdirSync(target_dir, { recursive: true }); }

		copyFileSync(canonical_path, local_path);
		copied.push(rel);
		ok(`${rel}`);
	}

	if (copied.length > 0) {
		console.log(`\n${BOLD}Reformatting with reettier...${RESET}`);
		const result = Bun.spawnSync(["reettier", ...copied.map((r) => join(root, "lib", r))], {
			cwd: root,
		});
		if (result.exitCode === 0) {
			ok(`${copied.length} file(s) copied and reformatted`);
		} else {
			const stderr = result.stderr.toString().trim();
			warn(`reettier had issues: ${stderr || "exit code " + result.exitCode}`);
			ok(`${copied.length} file(s) copied (reettier may have had warnings)`);
		}
	}

	if (errors.length > 0) {
		console.log();
		err(`${errors.length} file(s) had errors`);
		process.exit(1);
	}

	console.log();
	info("Run 'bun run engine:check' to verify drift is resolved.");
}

main();
