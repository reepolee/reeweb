/**
 * scripts/dev/template_data.ts
 *
 * Loads a template's sibling `.ts` data module (`load_template_data()`). In dev
 * these are re-imported on each request since they change often; failures are
 * logged and return {} so a broken data file doesn't take down the page.
 */

import { existsSync, statSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

export async function load_template_data(rel_path: string, public_dir: string): Promise<Record<string, any>> {
	const data_full_path = join(public_dir, rel_path.replace(/\.ree$/, ".ts"));
	if (!existsSync(data_full_path)) return {};

	try {
		// Bun caches ES modules by URL, so a plain re-import keeps serving stale
		// data after a `.ts` edit. Bust the cache on file mtime so data changes
		// hot-reload in dev (without growing the registry per request).
		const mtime = statSync(data_full_path).mtimeMs;
		const data_module = await import(`${pathToFileURL(data_full_path).href}?t=${mtime}`);
		if (typeof data_module.load_template_data === "function") {
			return (await data_module.load_template_data()) ?? {};
		}
	} catch (err) {
		console.warn(`[template_data] ${rel_path}:`, (err as Error).message ?? err);
	}

	return {};
}
