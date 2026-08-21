/**
 * scripts/release.ts - reeweb release entrypoint.
 *
 * Bumps ree-web's own package.json version and commits/pushes that bump,
 * then stages the `.releaseignore`-filtered source into the sibling public
 * checkout (`../reeweb`) for review. It never commits or pushes the public
 * repository - that stays a manual step.
 */

import { resolve, join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { update_override_hashes, stage_and_mirror_release_files } from "./release_files";

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

function read_project_version(): string {
	const pkg_path = join(PROJECT_ROOT, "package.json");
	const pkg = JSON.parse(readFileSync(pkg_path, "utf-8"));
	return pkg.version ?? "1.0.0";
}

function write_project_version(version: string): void {
	const pkg_path = join(PROJECT_ROOT, "package.json");
	const pkg = JSON.parse(readFileSync(pkg_path, "utf-8"));
	pkg.version = version;
	writeFileSync(pkg_path, JSON.stringify(pkg, null, "\t") + "\n");
}

function run_git(args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], { cwd: PROJECT_ROOT, stdio: ["inherit", "inherit", "inherit"] });
	if (result.exitCode !== 0) { throw new Error(`git ${args.join(" ")} failed`); }
}

function commit_and_push_version(version: string): void {
	run_git(["add", "package.json"]);
	run_git(["commit", "-m", `Bump version to ${version}`]);
	run_git(["push", "origin", "main"]);
}

function assert_clean_public_checkout(): void {
	if (!existsSync(join(PUBLIC_PROJECT_DIR, ".git"))) {
		throw new Error(`Public reeweb checkout not found at ${PUBLIC_PROJECT_DIR}`);
	}

	const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: PUBLIC_PROJECT_DIR });
	if (result.exitCode !== 0) { throw new Error(`Unable to inspect public reeweb checkout at ${PUBLIC_PROJECT_DIR}`); }
	if (result.stdout.toString().trim()) {
		throw new Error(`Public reeweb checkout has uncommitted changes: ${PUBLIC_PROJECT_DIR}`);
	}
}

async function release(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.log("Usage: bun release [--dry-run|--update-hashes]");
		return;
	}
	if (args.some((arg) => arg !== "--dry-run" && arg !== "--update-hashes")) {
		throw new Error("Unsupported release option. Use --dry-run to inspect the release file count, or --update-hashes to resync .override.* hashes.");
	}

	if (args.includes("--update-hashes")) {
		const updated_paths = update_override_hashes(PROJECT_ROOT);
		console.log(`Updated ${updated_paths.length} override hash${updated_paths.length === 1 ? "" : "es"}.`);
		for (const path of updated_paths) console.log(`  ${path}`);
		return;
	}

	const dry_run = args.includes("--dry-run");

	if (!dry_run) {
		const current_version = read_project_version();
		const version = bump_patch_version(current_version);
		console.log(`Bumping package.json version ${current_version} -> ${version}`);
		write_project_version(version);
		commit_and_push_version(version);

		assert_clean_public_checkout();
	}

	const result = await stage_and_mirror_release_files(PROJECT_ROOT, PUBLIC_PROJECT_DIR, dry_run);
	console.log(`${dry_run ? "Would stage" : "Staged"} ${result.entry_count} release entries${result.override_count ? ` (${result.override_count} override${result.override_count === 1 ? "" : "s"})` : ""}.`);
	if (!dry_run) console.log("Review ../reeweb, then commit and push it manually when ready.");
}

if (import.meta.main) {
	release().catch((err) => {
		console.error("Release failed:", err.message);
		process.exit(1);
	});
}
