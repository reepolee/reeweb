#!/usr/bin/env bun

/**
 * scripts/ssg.ts
 *
 * Static site generator entrypoint: renders .ree templates and .md files from a
 * source directory to static HTML, with full multi-language support, content
 * collections, and pagination.
 *
 * Usage:
 *   bun scripts/ssg.ts [--public ./src/public] [--dist ./dist] [--base-url /] [--site-url https://example.com]
 *   bun scripts/ssg.ts --help
 *
 * The SSG pipeline itself lives in scripts/ssg/ - this file only wires the pieces
 * together and runs the pipeline when executed directly. The module layout
 * mirrors lib/template/ (a thin orchestrator delegating to focused, individually
 * testable modules):
 *
 *   ssg/cli.ts               - argument parsing
 *   ssg/translation_merge.ts - translation tree navigation + merge
 *   ssg/markdown.ts          - .md language resolution + title extraction
 *   ssg/collections.ts       - content-collection frontmatter validation
 *   ssg/routing.ts           - canonical→localized resolution + output paths
 *   ssg/seo.ts               - absolute URLs + hreflang clusters
 *   ssg/page_data.ts         - the shared template render-data object
 *   ssg/sidebar.ts           - generic sidebar navigation
 *   ssg/render_templates.ts  - .ree render phase
 *   ssg/render_markdown.ts   - .md render phase
 *   ssg/render_pagination.ts - paginated-route render phase
 *   ssg/pipeline.ts          - orchestration (run_ssg)
 *
 * Output structure (using localized route names):
 *   /dist/
 *     index.html              ← default language (SL) at root
 *     /o-nas/index.html       ← SL localized /about → "o-nas"
 *     /en/                    ← other languages with /{lang} prefix
 *       index.html
 *       /about/index.html
 *
 * Language-variant templates (about.sl.ree → about.en.ree → about.ree) are
 * resolved automatically by the template engine.
 */

import { join } from "path";

import { parse_args } from "./ssg/cli";
import { run_ssg } from "./ssg/pipeline";
import { print_single_page } from "./ssg/print_page";

export { validate_entries } from "./ssg/collections";
export type { CollectionIssue } from "./ssg/types";

/**
 * Render only the requested page and print its full URL +
 * HTML to stdout. See ssg/print_page.ts for how a single page is resolved
 * and rendered through the same functions the batch phases use.
 */
async function print_rendered_page(options: ReturnType<typeof parse_args>, request_url: string): Promise<void> {
	const output_rel = await print_single_page(options, request_url);
	const html = await Bun.file(join(options.dist_dir, output_rel)).text();
	console.log(`${options.site_url}${request_url}`);
	console.log(html);
}

// Only run the SSG when executed directly (`bun scripts/ssg.ts`), not when
// imported - e.g. a test importing `validate_entries` must not trigger a render pass.
if (import.meta.main) {
	try {
		const options = parse_args();
		if (options.print_url) {
			await print_rendered_page(options, options.print_url);
			process.exit(0);
		}
		const { errors } = await run_ssg(options);
		process.exit(errors > 0 ? 1 : 0);
	} catch (err) {
		console.error(`❌ SSG failed:`, err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
