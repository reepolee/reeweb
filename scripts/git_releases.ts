#!/usr/bin/env bun
/**
 * Copies dist/ and wrangler.jsonc into the releases repo under a subfolder
 * named after this project folder, then commits and pushes.
 *
 * Usage: bun run git:releases
 */

import { join } from "node:path";
import { existsSync, cpSync, rmSync } from "node:fs";

const root = import.meta.dir + "/..";
const releases_arg = process.argv[2];
if (!releases_arg) {
	console.error("Usage: bun scripts/git_releases.ts <path-to-releases-repo>");
	process.exit(1);
}
const project_name = import.meta.dir.split(/[\\/]/).at(-2)!;
const releases_root = join(root, releases_arg);
const releases_path = join(releases_root, project_name);
const artifacts = ["dist", "wrangler.jsonc", "cf-worker.ts"];

const existing_artifacts = artifacts.filter((artifact) => {
	if (!existsSync(join(root, artifact))) {
		console.log(`Skipping ${artifact} (not found)`);
		return false;
	}
	return true;
});

// Clear previous artifacts in releases target folder
if (existsSync(releases_path)) { rmSync(releases_path, { recursive: true, force: true }); }

// Copy artifacts
for (const artifact of existing_artifacts) {
	console.log(`Copying ${artifact}...`);
	cpSync(join(root, artifact), join(releases_path, artifact), { recursive: true });
}

// Commit and push
const version = process.env.npm_package_version ?? "unknown";
await Bun.$`git add -A`.cwd(releases_root);
const status = await Bun.$`git status --porcelain`.cwd(releases_root).text();
if (!status.trim()) {
	console.log("Nothing changed, skipping commit.");
} else {
	await Bun.$`git commit -m ${`${project_name} build ${version}`}`.cwd(releases_root);
	await Bun.$`git push`.cwd(releases_root);
	console.log("Pushed to releases repo.");
}
