/**
 * scripts/dev/static_files.ts
 *
 * Resolution of files served verbatim: static assets (from public/ and
 * static/) and generated build artifacts (sitemap, feeds) served from dist/
 * as a dev convenience.
 *
 * Sitemap and RSS/JSON feeds are emitted to dist/ by the build scripts, not
 * served from src/public/. To avoid 404s on links like /sitemap.xml in dev,
 * we serve the last-built copy from dist/. These are stale until the next
 * `bun run ssg` (or `bun run sitemap` / `bun run rss`).
 *
 * robots.txt is intentionally excluded: dev keeps serving the source
 * src/public/robots.txt (Disallow: /) so the dev server stays unindexable.
 */

import { existsSync } from "fs";
import { join } from "path";

export type StaticDirs = { public_dir: string; static_dir: string; };

/** Find a static asset for `url_path` in public/ then static/, or null. */
export function find_static_file(url_path: string, dirs: StaticDirs): string | null {
	const cleaned = url_path.replace(
		/^\//,
		""
	);

	// Try public/ first - but never serve source files (templates, data, i18n).
	const pub = join(dirs.public_dir, cleaned);
	if (existsSync(pub) && !pub.endsWith(".ree") && !pub.endsWith(".md") && !pub.endsWith(".json") && !pub.endsWith(
		".ts"
	)) { return pub; }

	const stat = join(dirs.static_dir, cleaned);
	if (existsSync(stat)) return stat;

	return null;
}

/** Whether `url_path` is a build-generated artifact (sitemap / feeds / search). */
export function is_generated_artifact(url_path: string): boolean {
	if (url_path === "/sitemap.xml") return true;
	if (url_path.endsWith("/feed.xml") || url_path.endsWith("/feed.json")) return true;
	// Matches the whole-site index at /search-index.json and any per-source
	// index below a prefix (e.g. /docs/search-index.json).
	if (url_path.endsWith("/search-index.json")) return true;
	return false;
}

/** Find a previously-built artifact in dist/, or null. */
export function find_dist_artifact(url_path: string, dist_dir: string): string | null {
	if (!is_generated_artifact(url_path)) return null;

	const candidate = join(
		dist_dir,
		url_path.replace(
			/^\//,
			""
		)
	);
	if (existsSync(candidate)) return candidate;

	return null;
}

/** HTML hint shown when a known artifact has not been built yet. */
export function not_built_hint(url_path: string): string {
	return `<h1>404 Not Found</h1><p><code>${url_path}</code> is a generated artifact. ` + `Run <code>bun run ssg</code> (or <code>bun run sitemap</code> / ` + `<code>bun run rss</code> / <code>bun run ssg:search</code>) to produce it in ` + `<code>dist/</code>.</p>`;
}
