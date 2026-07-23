#!/usr/bin/env bun

import { resolve } from "path";

import { sync_dynamic_assets } from "./dynamic_assets/sync";

const args = Bun.argv.slice(2);
const unknown_arg = args.find((arg) => arg !== "--force");
if (unknown_arg) {
	throw new Error(`Unknown dynamic asset sync argument: "${unknown_arg}"`);
}

const base_url = Bun.env.REEPOLEE_API_URL;
if (!base_url) {
	console.log("Dynamic asset synchronization skipped: REEPOLEE_API_URL is not set.");
	process.exit(0);
}

const project_root = resolve(import.meta.dir, "..");
const force = args.includes("--force");
const result = await sync_dynamic_assets({ base_url, project_root, force });
console.log("Dynamic assets synchronized:");
console.log(`  Images: ${result.images.added} added, ${result.images.updated} updated, ${result.images.deleted} deleted, ${result.images.unchanged} unchanged`);
console.log(`  Files:  ${result.files.added} added, ${result.files.updated} updated, ${result.files.deleted} deleted, ${result.files.unchanged} unchanged`);
