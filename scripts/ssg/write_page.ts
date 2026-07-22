/**
 * scripts/ssg/write_page.ts
 *
 * Tiny shared output helper: ensure the parent directory exists, then write
 * the rendered HTML. Shared by all three render phases.
 */

import { mkdirSync } from "fs";
import { dirname } from "path";

export async function write_page(output_path: string, html: string): Promise<void> {
	mkdirSync(dirname(output_path), { recursive: true });
	await Bun.write(output_path, html);
}
