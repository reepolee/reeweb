/**
 * Include path resolver - pure function extracted from TemplateEngine.
 *
 * Resolves include paths relative to the current template name.
 * Supports alias paths ($components/, $routes/, $lib/), relative paths,
 * views-root relative paths, and extension-based kind detection.
 */

import path, { dirname, extname, join, resolve as pathResolve } from "node:path";

import type { ResolveResult } from "./types";

/**
 * Resolve include path relative to the current template name.
 *
 * @param currentName - The current template name (views-root relative, no extension)
 * @param includeName - The include path to resolve
 * @param viewsDir    - Absolute path to the views directory
 * @param ext         - Template file extension (e.g. ".ree")
 *
 * Supports:
 * - Alias names: "$components/partial", "$routes/partial", "$lib/partial"
 * - Relative names: "./partial", "../partial", "./validation.js"
 * - Absolute-from-views root: "/pages/home" or "pages/home"
 * - Extension rules:
 * * ext === param.ext -> treat as template (compiled)
 * * other ext        -> treat as raw file (unescaped text)
 * * no ext           -> template with this.ext
 */
export function resolve_include(currentName: string, includeName: string, viewsDir: string, ext: string): ResolveResult {
	// Normalize includeName into views-relative form
	let name = includeName.trim();
	let isAliasPath = false;

	// ALIAS RESOLUTION - resolve to project root relative
	if (name.startsWith("$components/")) {
		name = name.replace("$components/", "components/");
		isAliasPath = true;
	} else if (name.startsWith("$routes/")) {
		name = name.replace("$routes/", "routes/");
		isAliasPath = true;
	} else if (name.startsWith("$lib/")) {
		name = name.replace("$lib/", "lib/");
		isAliasPath = true;
	}

	// If it starts with '/', drop the leading slash and treat as views-root relative
	if (!isAliasPath && name.startsWith("/")) {
		name = name.slice(1);
	} else if (!isAliasPath && (name.startsWith("./") || name.startsWith("../"))) {
		// Relative to the current template dir
		const baseDir = dirname(currentName);
		// Use posix-style joining to keep forward slashes in names
		const joined = path.posix.join(baseDir.replace(/\\\\/g, "/"), name);
		name = joined;
	}
	// else: treat as already views-root relative (e.g., "components/card") or alias path

	const fileExt = extname(name);

	if (fileExt) {
		if (fileExt === ext) {
			// Treat as template with explicit extension -> remove ext to get name used by render()
			const templateName = name.slice(0, -fileExt.length);

			// If it's an alias path, resolve relative to project root instead of viewsDir
			if (isAliasPath) {
				const projectRoot = dirname(viewsDir);
				const filePath = join(projectRoot, templateName + ext);
				// For alias templates, we need to load them directly since they're outside viewsDir
				return { kind: "raw", filePath }; // Will be treated as raw but compiled
			}

			return { kind: "template", templateName };
		} else {
			// Treat as raw file to be injected unescaped
			const basePath = isAliasPath ? dirname(viewsDir) : viewsDir;
			const rawFilePath = join(basePath, name);
			// Security: ensure it remains under appropriate directory
			const resolved = pathResolve(rawFilePath);
			const baseResolved = pathResolve(basePath);
			if (!resolved.startsWith(baseResolved)) {
				throw new Error(`Include path escapes base directory: ${includeName}`);
			}
			return { kind: "raw", filePath: resolved };
		}
	} else {
		// No extension -> template with default ext
		if (isAliasPath) {
			const projectRoot = dirname(viewsDir);
			const filePath = join(projectRoot, name + ext);
			return { kind: "raw", filePath }; // Will load and compile as .ree
		}
		return { kind: "template", templateName: name };
	}
}
