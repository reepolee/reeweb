/**
 * scripts/ssg/write_page.ts
 *
 * Tiny shared output helper: group each page's local /js/ script tags into
 * one immediate + one deferred bundle, ensure the parent directory exists,
 * then write the rendered HTML. Shared by all three render phases.
 */

import { mkdirSync } from "fs";
import { dirname, join } from "path";

import { group_page_scripts } from "./group_js";

export async function write_page(output_path: string, html: string, public_dir: string, dist_dir: string): Promise<void> {
	const grouped_html = await group_page_scripts(html, public_dir, dist_dir);
	mkdirSync(dirname(output_path), { recursive: true });
	await Bun.write(output_path, grouped_html);
}
