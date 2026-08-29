/**
 * scripts/ssg/group_js.ts
 *
 * Groups a rendered page's local `<script src="/js/...">` tags into a single
 * immediate bundle and a single deferred bundle, so a page ships two script
 * requests instead of one per source file. External scripts (CDN URLs,
 * non-/js/ local paths like /web-components/*.js) are left untouched.
 *
 * Regex-based on purpose, mirroring reepolee-dev's move_styles_and_scripts_to_head:
 * an HTMLRewriter pass benchmarked slower for this shape of transform.
 *
 * Bundling is a one-shot build-time concatenation (no request-time cache
 * needed, unlike reepolee-dev's server): each unique ordered set of sources
 * is hashed once per `bun ssg` run and written to dist_dir/js/bundle*.<hash>.js.
 */

import { createHash } from "crypto";
import { join } from "path";

const script_with_src_regex = /<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*><\/script>/gi;

function is_local_js_src(src: string): boolean {
	return src.startsWith("/js/");
}

function normalize_src(src: string): string {
	return src.split("?")[0] ?? src;
}

const written_bundles = new Set<string>();

/** Concatenate the given local /js/ sources (in first-seen order) and write the bundle once. Returns its dist-relative URL. */
async function get_or_write_bundle(srcs: string[], public_dir: string, dist_dir: string, kind: "bundle" | "bundle-deferred"): Promise<string | null> {
	if (srcs.length === 0) return null;

	const unique_srcs = [...new Set(srcs.map(normalize_src))];
	const chunks: string[] = [];
	for (const src of unique_srcs) {
		const source_path = join(public_dir, src.replace(/^\//, ""));
		const source_file = Bun.file(source_path);
		if (!(await source_file.exists())) {
			console.warn(`[group_js] Source not found, skipping: ${src}`);
			continue;
		}
		chunks.push(await source_file.text());
	}

	if (chunks.length === 0) return null;

	const concatenated = chunks.join("\n;\n");
	const hash = createHash("sha256").update(concatenated).digest("hex").slice(0, 16);
	const output_rel = `js/${kind}.${hash}.js`;
	const output_url = `/${output_rel}`;

	if (!written_bundles.has(output_url)) {
		const output_path = join(dist_dir, output_rel);
		await Bun.write(output_path, concatenated);
		written_bundles.add(output_url);
	}

	return output_url;
}

/**
 * Replace every local `/js/...` script tag in `html` with one immediate and
 * one deferred bundled tag, preserving each group's relative order and the
 * position of the last matched tag. Non-local (`/web-components/...`,
 * external CDN) script tags are left in place.
 */
export async function group_page_scripts(html: string, public_dir: string, dist_dir: string): Promise<string> {
	const immediate_srcs: string[] = [];
	const deferred_srcs: string[] = [];
	let last_match_index = -1;

	const stripped = html.replace(script_with_src_regex, (full_match, src: string, offset: number) => {
		if (!is_local_js_src(src)) return full_match;

		const is_deferred = /\bdefer\b/i.test(full_match);
		(is_deferred ? deferred_srcs : immediate_srcs).push(src);
		last_match_index = offset;
		return "\0GROUPED_JS_PLACEHOLDER\0";
	});

	if (last_match_index === -1) return html;

	const [immediate_url, deferred_url] = await Promise.all([
		get_or_write_bundle(immediate_srcs, public_dir, dist_dir, "bundle"),
		get_or_write_bundle(deferred_srcs, public_dir, dist_dir, "bundle-deferred"),
	]);

	let inserted = false;
	const with_bundles = stripped.replace(/\0GROUPED_JS_PLACEHOLDER\0/g, () => {
		if (inserted) return "";
		inserted = true;
		const immediate_tag = immediate_url ? `<script src="${immediate_url}"></script>` : "";
		const deferred_tag = deferred_url ? `<script src="${deferred_url}" defer></script>` : "";
		return [immediate_tag, deferred_tag].filter(Boolean).join("\n");
	});

	return with_bundles;
}
