#!/usr/bin/env bun

/**
 * scripts/remove_demo_content.ts
 *
 * Deletes the template's demo content - starter homepage, about/contact
 * pages, sample blog posts, and the reepolee docs pages - and strips their
 * translation keys and layout nav links. Run once when starting a real
 * project from this template.
 *
 * Deletion is immediate - no dry-run, no confirmation. Recovery is git or
 * re-extracting the template.
 *
 * Usage:
 *   bun scripts/remove_demo_content.ts
 *   bun scripts/remove_demo_content.ts --help
 */

import { remove_demo_content } from "./shared/demo_content";

function print_usage() {
	console.error("Usage: bun scripts/remove_demo_content.ts");
	console.error("");
	console.error("Deletes demo pages under src/public (homepage, about, contact, blog");
	console.error("samples, docs), strips their translation keys, and removes their nav");
	console.error("links from layout.ree. No dry-run - deletion is immediate.");
}

if (process.argv.includes("--help")) {
	print_usage();
	process.exit(0);
}

const report = remove_demo_content();

console.log("🗑️  Removed:");
for (const path of report.removed) console.log(`  - ${path}`);

if (report.replaced.length > 0) {
	console.log("");
	console.log("♻️  Replaced with stub:");
	for (const path of report.replaced) console.log(`  - ${path}`);
}

if (report.not_found.length > 0) {
	console.log("");
	console.log("⏭️  Already absent:");
	for (const path of report.not_found) console.log(`  - ${path}`);
}

if (report.translation_keys_removed.length > 0) {
	console.log("");
	console.log("🌐 Translation keys stripped:");
	for (const { file, keys_removed } of report.translation_keys_removed) {
		console.log(`  ${file}: ${keys_removed.join(", ")}`);
	}
}

if (report.layout_nav_links_removed.length > 0) {
	console.log("");
	console.log("🔗 Nav links removed from layout.ree:");
	for (const route of report.layout_nav_links_removed) console.log(`  - /${route}`);
}

console.log("");
console.log("═".repeat(50));
console.log(`✅ Demo content removed (${report.removed.length} paths)`);
console.log("═".repeat(50));
