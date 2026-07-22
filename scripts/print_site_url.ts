#!/usr/bin/env bun

/**
 * scripts/print_site_url.ts
 *
 * Prints SITE_URL (from .env) as a clickable link. Used after `wrangler
 * deploy` to surface the final deployed URL.
 */

const site_url: string | undefined = process.env.SITE_URL;

if (!site_url) {
	console.error("✗ SITE_URL is required (set it in .env)");
	process.exit(1);
}

console.log("");
console.log(`    \x1b[32m${site_url}\x1b[0m`);
console.log("");
