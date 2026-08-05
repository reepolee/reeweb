/**
 * scripts/ssg/cli.ts
 *
 * Command-line argument parsing for the static build. `parse_args` takes
 * the argv slice explicitly (defaulting to the real process args) so it
 * can be unit-tested without touching process state.
 */

import { resolve } from "path";

import type { BuildOptions } from "./types";

export function print_usage(): void {
	console.error("Usage: bun scripts/ssg.ts [options]");
	console.error("");
	console.error("Options:");
	console.error("  --public <dir>   Source directory with .ree templates (default: ./src/public)");
	console.error("  --dist <dir>     Output directory for static HTML (default: ./dist)");
	console.error("  --base-url <url> Base URL for the site (default: /)");
	console.error(
		"  --site-url <url> Full site URL for canonical/hreflang links (required, or set SITE_URL in .env)"
	);
	console.error("  --print-url <path> After building, print the rendered page's full URL + HTML to stdout");
	console.error("  --dev            With --print-url, render with is_dev: true (dev-only template blocks show)");
	console.error("  --verbose        Log each rendered file");
	console.error("  --help           Print this usage and exit");
}

/**
 * Parse build options from an argv slice. Pure aside from `--help`, which
 * prints usage and exits; pass `{ on_help }` to override that in tests.
 */
export function parse_args(argv: string[] = process.argv.slice(2), on_help: () => void = () => {
	print_usage();
	process.exit(0);
}): BuildOptions {
	if (argv.includes("--help")) { on_help(); }

	let public_dir = "./src/public";
	let dist_dir = "./dist";
	// BASE_URL and SITE_URL are env-only (strict, set in .env); their flags
	// override. No hidden code defaults - a missing value with no flag errors.
	let base_url: string | undefined = process.env.BASE_URL;
	let site_url: string | undefined = process.env.SITE_URL;
	let verbose = false;
	let print_url: string | undefined;
	let dev = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === "--public") {
			public_dir = argv[++i] ?? public_dir;
		} else if (arg === "--dist") {
			dist_dir = argv[++i] ?? dist_dir;
		} else if (arg === "--base-url") {
			base_url = argv[++i] ?? base_url;
		} else if (arg === "--site-url") {
			site_url = argv[++i] ?? site_url;
		} else if (arg === "--print-url") {
			print_url = argv[++i] ?? print_url;
		} else if (arg === "--verbose") {
			verbose = true;
		} else if (arg === "--dev") {
			dev = true;
		}
	}

	if (!base_url) {
		console.error("✗ --base-url is required (or set BASE_URL in .env)");
		print_usage();
		process.exit(1);
	}
	if (!site_url) {
		console.error("✗ --site-url is required (or set SITE_URL in .env)");
		print_usage();
		process.exit(1);
	}

	return {
		public_dir: resolve(public_dir),
		dist_dir: resolve(dist_dir),
		base_url,
		site_url: site_url.replace(/\/+$/, ""),
		verbose,
		print_url,
		dev,
	};
}
