#!/usr/bin/env bun

/**
 * scripts/preview.ts
 *
 * Preview server for the static dist output.
 * Serves the dist directory and redirects root to the default locale.
 *
 * Usage:
 *   bun scripts/preview.ts                   # serve ./dist on :3000
 *   bun scripts/preview.ts --port 8080       # custom port
 *   bun scripts/preview.ts --dir ./my-dist   # custom dist dir
 */

import { existsSync, readdirSync } from "fs";
import { join, resolve, extname } from "path";

import { default_locale, locale_names, locales } from "../config/supported_locales.ts";
import { locale_url_segment } from "../src/lib/locale.ts";
import { listen_for_open_key } from "./server_controls";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
};

function mime_type(path: string): string {
	return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

let dist_dir = "./dist";
// PORT is env-only (strict, set in .env); --port overrides it. No hidden code
// default - a missing PORT with no flag is an ingress error.
let port_raw: string | undefined = process.env.PORT;

for (let i = 0; i < process.argv.length; i++) {
	const arg = process.argv[i];
	if (!arg) continue;

	if (arg === "--dir" || arg === "--dist") {
		dist_dir = process.argv[++i] ?? dist_dir;
	} else if (arg === "--port" || arg === "-p") {
		port_raw = process.argv[++i] ?? port_raw;
	} else if (arg === "--help" || arg === "-h") {
		console.log("Usage: bun scripts/preview.ts [--dist ./dist] [--port 3000]");
		process.exit(0);
	}
}

const port = Number(port_raw);
if (!port_raw || !Number.isFinite(port) || port <= 0) {
	console.error("✗ port is required (set PORT in .env or pass --port)");
	process.exit(1);
}

dist_dir = resolve(dist_dir);

if (!existsSync(dist_dir)) {
	console.error(`✗ Directory not found: ${dist_dir}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Detect locales: root-level default + subdirectory locales (lowercased dirs)
// ---------------------------------------------------------------------------

const sub_locale_dirs: string[] = [];
for (const entry of readdirSync(dist_dir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const matched_locale = (locales as readonly string[]).find((locale) => locale_url_segment(
		locale
	) === entry.name.toLowerCase());
	if (matched_locale) sub_locale_dirs.push(matched_locale);
}

// If dist/index.html exists, the default locale is served at root
const has_root_locale = existsSync(join(dist_dir, "index.html"));

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

Bun.serve(
	{
		port,
		async fetch(req: Request): Promise<Response> {
			const url = new URL(req.url);
			const path = url.pathname;

			// Root → serve default locale homepage directly
			if (path === "/" || path === "") {
				const root_index = join(dist_dir, "index.html");
				if (existsSync(root_index)) {
					const file = Bun.file(root_index);
					return new Response(file, {
						headers: {
							"Content-Type": "text/html; charset=utf-8",
							"Content-Disposition": "inline",
						},
					});
				}
			}

			// If path is a directory, try index.html
			if (!extname(path)) {
				// Try as directory with index.html
				const dir_index = join(dist_dir, path, "index.html");
				if (existsSync(dir_index)) {
					const file = Bun.file(dir_index);
					return new Response(file, {
						headers: {
							"Content-Type": mime_type(dir_index),
							"Content-Disposition": "inline",
						},
					});
				}

				// Try as extensionless .html path (e.g. /en/about → /en/about.html)
				const html_path = join(dist_dir, path + ".html");
				if (existsSync(html_path)) {
					const file = Bun.file(html_path);
					return new Response(file, {
						headers: {
							"Content-Type": mime_type(html_path),
							"Content-Disposition": "inline",
						},
					});
				}
			}

			// Serve the file from dist
			const file_path = join(dist_dir, path);
			if (existsSync(file_path)) {
				const file = Bun.file(file_path);
				return new Response(file, {
					headers: {
						"Content-Type": mime_type(file_path),
						"Content-Disposition": "inline",
					},
				});
			}

			// 404
			return new Response("Not Found", { status: 404 });
		},
	}
);

const default_locale_name = locale_names[default_locale] ?? default_locale;
const all_locales = [...(has_root_locale ? [default_locale] : []), ...sub_locale_dirs.sort()];

console.log(`🖥️ Preview server ready`);
console.log("");
const serving_url = `http://localhost:${port}/`;
console.log(`    \x1b[32m${serving_url}\x1b[0m`);
console.log("");
console.log(`    📂 Serving: ${dist_dir}`);
console.log(`    🌐 Locales: ${all_locales.length > 0 ? all_locales.join(", ") : "none"}`);

if (has_root_locale) {
	console.log(
		`    ↳ Default locale "${default_locale}" (${default_locale_name}) served at / (no prefix)`
	);
} else if (sub_locale_dirs.length > 0) {
	console.log(`    ↳ Opening / will try index.html or fall back to 404`);
}

console.log("");
listen_for_open_key(serving_url);
