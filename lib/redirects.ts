/**
 * lib/redirects.ts
 *
 * Load, validate, and emit site redirects. Authored in `config/redirects.ts`.
 *
 * Two-phase contract with `scripts/ssg.ts`:
 *   - Phase 1 (early):  load_and_validate_redirects()
 *   - Phase 2 (late):   check_collisions_and_validate_targets()
 *                       emit_redirects()
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export type Redirect = { from: string; to: string; status?: 301 | 302; };

export class RedirectsError extends Error {
	override name = "RedirectsError";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function last_segment(path: string): string {
	const parts = path.split("/").filter(Boolean);
	const last = parts[parts.length - 1];
	return last ?? "";
}

function is_external(to: string): boolean {
	return to.startsWith("http://") || to.startsWith("https://");
}

function html_escape(s: string): string {
	const amp = s.replace(/&/g, "&amp;");
	const lt = amp.replace(/</g, "&lt;");
	const gt = lt.replace(/>/g, "&gt;");
	const dq = gt.replace(/"/g, "&quot;");
	const sq = dq.replace(/'/g, "&#39;");
	return sq;
}

/** Strip a single trailing slash (but never reduce "/" to ""). */
function strip_trailing_slash(p: string): string {
	if (p.length <= 1) return p;
	return p.endsWith("/") ? p.slice(0, -1) : p;
}

// ---------------------------------------------------------------------------
// Phase 1: schema validation
// ---------------------------------------------------------------------------

/**
 * Schema-validate the redirects array (called early in the build, before any
 * rendering work, so a bad config fails fast).
 *
 * Checks:
 *  - input is an array of objects
 *  - `from` is a string, starts with "/", last segment has no "."
 *  - `to` is a non-empty string
 *  - `status` (if present) is 301 or 302
 *  - no duplicate `from` (trailing slashes normalized for comparison)
 *
 * Throws `RedirectsError` on the first violation. Returns the validated
 * array with `from` values normalized (no trailing slash, except "/").
 */
export function load_and_validate_redirects(input: unknown): Redirect[] {
	if (!Array.isArray(input)) {
		throw new RedirectsError("config/redirects.ts: expected `redirects` to be an array");
	}

	const seen = new Set<string>();
	const result: Redirect[] = [];

	for (let i = 0; i < input.length; i++) {
		const entry = input[i];
		const label = `redirects[${i}]`;

		if (!entry || typeof entry !== "object") {
			throw new RedirectsError(`${label}: expected an object`);
		}

		const raw = entry as Record<string, unknown>;
		const from = raw.from;
		const to = raw.to;
		const status = raw.status;

		if (typeof from !== "string") { throw new RedirectsError(`${label}: \`from\` must be a string`); }
		if (!from.startsWith("/")) {
			throw new RedirectsError(`${label}: \`from\` must start with "/" (got "${from}")`);
		}

		const seg = last_segment(from);
		if (seg.includes(".")) {
			throw new RedirectsError(
				`${label}: \`from\` must not contain a file extension (got "${from}"). Pretty URLs only - the build cannot emit an HTML stub for a path with an extension.`,
			);
		}

		if (typeof to !== "string" || to.length === 0) {
			throw new RedirectsError(`${label}: \`to\` must be a non-empty string`);
		}

		if (status !== undefined && status !== 301 && status !== 302) {
			throw new RedirectsError(
				`${label}: \`status\` must be 301 or 302 (got ${String(status)})`,
			);
		}

		const normalized = strip_trailing_slash(from);

		if (seen.has(normalized)) {
			throw new RedirectsError(`${label}: duplicate \`from\` "${normalized}"`);
		}
		seen.add(normalized);

		result.push({ from: normalized, to, status: status as 301 | 302 | undefined });
	}

	return result;
}

// ---------------------------------------------------------------------------
// Phase 2: collision + target validation
// ---------------------------------------------------------------------------

/**
 * Catch the silent footguns once `dist/` is in its final state:
 *   - `from` collides with a generated page route
 *   - `from` collides with a static asset copied to `dist/`
 *   - internal `to` does not resolve to an actual file in `dist/`
 *
 * `generated_routes` holds URL-form paths the renderer produced
 *   (e.g. "/", "/about/", "/en/about/").
 * `static_asset_paths` holds URL-form paths copied verbatim
 *   (e.g. "/favicon.ico", "/files/resume-2026-v3.pdf").
 *
 * Throws `RedirectsError` on the first violation.
 */
export function check_collisions_and_validate_targets(redirects: Redirect[], dist_dir: string, generated_routes: Set<string>, static_asset_paths: Set<string>): void {
	for (const r of redirects) {
		// Type 2: collision with a generated page route
		const route_with_slash = r.from === "/" ? "/" : r.from + "/";
		if (generated_routes.has(route_with_slash) || generated_routes.has(r.from)) {
			throw new RedirectsError(
				`Redirect from="${r.from}": collides with a generated page at the same path. Delete the page template or change the redirect.`,
			);
		}

		// Type 3: collision with a static asset
		if (static_asset_paths.has(r.from)) {
			throw new RedirectsError(
				`Redirect from="${r.from}": collides with a static asset copied verbatim to dist/. Delete the asset or change the redirect.`,
			);
		}

		// Target existence (internal only - external URLs aren't fetched at build time)
		if (!is_external(r.to)) {
			const target_seg = last_segment(r.to);
			const looks_like_file = target_seg.includes(".");
			const candidates = looks_like_file ? [join(dist_dir, r.to)] : [
				join(dist_dir, r.to, "index.html"),
				join(dist_dir, r.to),
			];

			const found = candidates.some((p) => existsSync(p));
			if (!found) {
				throw new RedirectsError(`Redirect from="${r.from}" to="${r.to}": target does not exist in dist/. Checked: ${candidates.join(
					", "
				)}`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 2: emission
// ---------------------------------------------------------------------------

/**
 * Write `dist/_redirects` (Cloudflare format) and per-entry HTML stubs.
 * For each redirect, the `_redirects` file gets two lines (with and without
 * trailing slash) so both `/resume` and `/resume/` redirect at the edge.
 * The HTML stub lives at `dist/{from}/index.html` and is the fallback path
 * for local preview and non-Cloudflare hosts.
 *
 * No-op when the redirects array is empty.
 */
export async function emit_redirects(redirects: Redirect[], dist_dir: string): Promise<void> {
	if (redirects.length === 0) return;

	// 1. Cloudflare _redirects file
	const lines: string[] = [];
	for (const r of redirects) {
		const status = r.status ?? 301;
		lines.push(`${r.from} ${r.to} ${status}`);
		if (r.from !== "/") { lines.push(`${r.from}/ ${r.to} ${status}`); }
	}

	const redirects_file = join(dist_dir, "_redirects");
	await Bun.write(redirects_file, lines.join("\n") + "\n");

	// 2. HTML stubs
	for (const r of redirects) {
		const stub_dir = r.from === "/" ? dist_dir : join(dist_dir, r.from);
		const stub_path = join(stub_dir, "index.html");

		mkdirSync(stub_dir, { recursive: true });
		await Bun.write(stub_path, build_stub_html(r.to));
	}
}

/** Minimal redirect-fallback HTML stub: meta-refresh + canonical (internal targets only) + visible link. */
export function build_stub_html(to: string): string {
	const escaped = html_escape(to);
	const canonical = is_external(to) ? "" : `\n<link rel="canonical" href="${escaped}">`;

	return `<!DOCTYPE html>
<meta charset="utf-8">
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0;url=${escaped}">${canonical}
<p>Redirecting to <a href="${escaped}">${escaped}</a>…</p>
`;
}
