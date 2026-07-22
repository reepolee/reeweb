/**
 * Include handler - extracted from TemplateEngine.includeResolved().
 *
 * Handles runtime include dispatch:
 * - For templates (kind === "template"): delegates to render()
 * - For raw .ree file paths: loads and compiles with language variant fallback
 * - For non-ree raw files: reads and returns as-is
 */

import { extname } from "node:path";

import { default_language } from "$config/supported_languages";
import { file } from "bun";

import type { CompiledFn, ResolveResult } from "./types";

// async file existence check - avoids sync fs calls in the render path
async function file_exists(p: string): Promise<boolean> { return await file(p).exists(); }

/**
 * Dependencies needed from the TemplateEngine instance.
 */
export interface IncludeHandlerDeps {
	resolve_include(currentName: string, includeName: string): ResolveResult;
	render(name: string, props: Record<string, any>): Promise<string>;
	compile(template: string): CompiledFn;
	include(name: string, props: Record<string, any>): Promise<string>;
	autoEscape: boolean;
	escape(s: any): string;
	ext: string;
}

/**
 * Resolve and execute an include directive at render time.
 *
 * Routes through the dependency-injected TemplateEngine methods to
 * avoid circular module dependencies and keep the function pure.
 */
export async function include_resolved_handler(deps: IncludeHandlerDeps, currentName: string, includeName: string, props: Record<string, any>): Promise<string> {
	const info = deps.resolve_include(currentName, includeName);
	if (info.kind === "template") {
		return await deps.render(info.templateName!, props);
	} else {
		const p = info.filePath!;
		if (!(await file_exists(p))) { throw new Error(`Included file not found: ${p}`); }

		// Check if it's a .ree template file that should be compiled
		if (extname(p) === deps.ext) {
			// Try language variants for raw .ree paths (e.g., components):
			// {dir}/{base}.{lang}.ree -> {dir}/{base}.{default_language}.ree -> {dir}/{base}.ree
			let resolvedFilePath = p;
			const resolveLang = props?.lang;
			if (resolveLang) {
				const baseName = p.slice(0, -deps.ext.length);
				const langCandidates = [
					`${baseName}.${resolveLang}${deps.ext}`,
					`${baseName}.${default_language}${deps.ext}`,
					p,
				];
				for (const lc of langCandidates) {
					if (await file_exists(lc)) {
						resolvedFilePath = lc;
						break;
					}
				}
			}
			const templateContent = await file(resolvedFilePath).text();
			const compiledFn = deps.compile(templateContent);
			const boundInclude = deps.include;
			const rtInclude = (name: string, data: Record<string, any>) => include_resolved_handler(
				deps,
				includeName,
				name,
				data
			);
			const escape = deps.autoEscape ? deps.escape : (s: any) => String(s ?? "");
			// @ts-expect-error
			return await (compiledFn as any)(props, escape, boundInclude, rtInclude, includeName);
		} else {
			// Raw file injected unescaped
			const f = file(p);
			return await f.text();
		}
	}
}
