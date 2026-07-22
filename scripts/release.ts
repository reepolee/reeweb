/**
 * scripts/release.ts — ReeWeb private-source release entrypoint.
 *
 * Stages the `.releaseignore`-filtered source into the sibling public checkout
 * (`../reeweb`) for review. It never commits or pushes either repository.
 *
 */

import { resolve, join } from "path";
import { existsSync } from "fs";
import { stage_and_mirror_release_files } from "./release_files";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const PUBLIC_PROJECT_DIR = resolve(PROJECT_ROOT, "..", "reeweb");

export function format_release_version(year: number, month: number, patch: number): string {
	const month_str = String(month).padStart(2, "0");
	return `${year}.${month_str}.${patch}`;
}

export function bump_patch_version(version: string): string {
	const parts = version.split(".");
	if (parts.length !== 3) { throw new Error(`Unsupported version format: ${version}`); }

	const year = Number.parseInt(parts[0] ?? "", 10);
	const month = Number.parseInt(parts[1] ?? "", 10);
	const patch = Number.parseInt(parts[2] ?? "", 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(patch)) {
		throw new Error(`Unsupported version format: ${version}`);
	}

	return format_release_version(year, month, patch + 1);
}

function assert_clean_public_checkout(): void {
	if (!existsSync(join(PUBLIC_PROJECT_DIR, ".git"))) {
		throw new Error(`Public ReeWeb checkout not found at ${PUBLIC_PROJECT_DIR}`);
	}

	const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: PUBLIC_PROJECT_DIR });
	if (result.exitCode !== 0) { throw new Error(`Unable to inspect public ReeWeb checkout at ${PUBLIC_PROJECT_DIR}`); }
	if (result.stdout.toString().trim()) {
		throw new Error(`Public ReeWeb checkout has uncommitted changes: ${PUBLIC_PROJECT_DIR}`);
	}
}

async function release(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.log("Usage: bun release [--dry-run]");
		return;
	}
	if (args.some((arg) => arg !== "--dry-run")) {
		throw new Error("Unsupported release option. Use --dry-run to inspect the release file count.");
	}
	const dry_run = args.includes("--dry-run");

	if (!dry_run) {
		assert_clean_public_checkout();
	}

	const result = await stage_and_mirror_release_files(PROJECT_ROOT, PUBLIC_PROJECT_DIR, dry_run);
	console.log(`${dry_run ? "Would stage" : "Staged"} ${result.entry_count} release entries${result.override_count ? ` (${result.override_count} override${result.override_count === 1 ? "" : "s"})` : ""}.`);
	if (!dry_run) console.log("Review ../reeweb, then commit and push it manually when ready.");
}

if (import.meta.main) {
	release().catch((err) => {
		console.error("❌ Release failed:", err.message);
		process.exit(1);
	});
}
