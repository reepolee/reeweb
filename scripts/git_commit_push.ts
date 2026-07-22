#!/usr/bin/env bun

import { version } from "../package.json";

if (!version) {
	console.error("package.json does not contain a version");
	process.exit(1);
}

await Bun.$`git add -A`.quiet();

const statusResult = await Bun.$`git status --porcelain --untracked-files=no`.text();
const hasStagedChanges = statusResult.trim().length > 0;

if (!hasStagedChanges) {
	console.log("Nothing to commit, skipping git:commit-push.");
	process.exit(0);
}

await Bun.$`git commit -m ${`Release ${version}`}`.quiet();
await Bun.$`git branch -M main`.quiet();
await Bun.$`git push`.quiet();
