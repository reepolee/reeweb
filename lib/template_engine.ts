/**
 * File-Based Template Engine - Inspired by Eta.js & Svelte
 * Pure vanilla JavaScript implementation with layouts and partials
 * Optimized for Bun runtime
 *
 * Tags and directives:
 * - {= expr }     -> escaped output
 * - {~ expr }     -> unescaped output
 * - {{ ... }}     -> raw JS (double braces)
 * - {#layout('path', props?) }
 * - {#include('path', props?) }    // treated as HTML block; not escaped as a whole
 * - {#each list as item[, index][, key] } ... {:else} ... {/each}
 * - {#if condition }              ... {:else} ... {/if}
 * - {#with expr }                 ... {/with}
 * - <tag ...identifier>     -> attribute spread shorthand for native elements and ReeTags
 * - <tag-name>...</tag-name>   -> custom HTML element shorthand (ReeTag)
 * (any tag whose name has at least one hyphen;
 * attributes on the tag are passed under props.attributes;
 * pre-processor emits a NUL marker that compile_to_code
 * resolves into a __rtInclude call)
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { default_language } from "$config/supported_languages";
import { file, write } from "bun";

import { compile_to_code as _compile_to_code } from "./template/compiler";
import { preprocess_template } from "./template/custom_elements";
import { include_resolved_handler, type IncludeHandlerDeps } from "./template/include_handler";
import { resolve_include } from "./template/include_resolver";
import type { CompiledFn } from "./template/types";

type Config = { views?: string; cache?: boolean; autoEscape?: boolean; ext?: string; };

class TemplateEngine {
	viewsDir: string;
	cache: boolean;
	autoEscape: boolean;
	ext: string;
	compiledCache: Record<string, CompiledFn>;

	constructor(config: Config = {}) {
		this.viewsDir = config.views || "./views";
		// cache only in production unless explicitly set
		this.cache = typeof config.cache === "boolean" ? config.cache : process.env.NODE_ENV === "production";
		this.autoEscape = config.autoEscape !== false;
		this.ext = config.ext || ".ree";
		this.compiledCache = {};
	}

	// Load template text from file
	async loadTemplate(name: string): Promise<string> {
		const filePath = join(this.viewsDir, name + this.ext);
		if (!existsSync(filePath)) { throw new Error(`Template file not found: ${filePath}`); }
		const f = file(filePath);
		return await f.text();
	}

	/**
	 * Load template with language-specific fallback chain:
	 * {name}.{lang}.ree -> {name}.{default_language}.ree -> {name}.ree
	 * Returns the content and the resolved name (for cache key usage).
	 */
	async loadLocalized(name: string, lang: string): Promise<{ content: string; resolvedName: string; }> {
		const candidates = [`${name}.${lang}`, `${name}.${default_language}`, name];
		for (const candidate of candidates) {
			const filePath = join(this.viewsDir, candidate + this.ext);
			if (existsSync(filePath)) {
				const f = file(filePath);
				return { content: await f.text(), resolvedName: candidate };
			}
		}
		throw new Error(`Template not found: ${name} (tried: ${candidates.map((c) => c + this.ext).join(
			", "
		)})`);
	}

	/**
	 * Internal: include with resolution relative to current template.
	 * Delegates to the extracted handler in include_handler.ts.
	 */
	private async includeResolved(currentName: string, includeName: string, props: Record<string, any>): Promise<string> {
		const deps: IncludeHandlerDeps = {
			resolve_include: (c, i) => resolve_include(c, i, this.viewsDir, this.ext),
			render: (n, p) => this.render(n, p),
			compile: (t) => this.compile(t),
			include: (n, p) => this.include(n, p),
			autoEscape: this.autoEscape,
			escape: (s) => this.escape(s),
			ext: this.ext,
		};
		return include_resolved_handler(deps, currentName, includeName, props);
	}

	/**
	 * Compile template string to async function
	 * Supports tags/directives:
	 * - {= expr }    (escaped)
	 * - {~ expr }    (unescaped)
	 * - {{ ... }}    (raw JS - double braces)
	 * - {#layout('path', props?) }
	 * - {#include('path', props?) }  (treated as HTML block; not escaped as a whole)
	 * - {#each list as item[, index][, key] } ... {:else} ... {/each}		 *  - {#if condition } ... {:else} ... {/if}
	 * - {#with expr } ... {/with}
	 * - <tag-name>...</tag-name>     (ReeTag; includes /components/tag-name.ree with props)
	 */
	compile(template: string) {
		const { fn } = this.compile_to_code(template);
		return fn;
	}

	/**
	 * Compile and return both the generated JavaScript source code and the
	 * compiled async render function. Useful for debugging and the MCP
	 * server's compile_template tool.
	 */
	compile_to_code(template: string): { code: string; fn: CompiledFn; } {
		// Pre-process: custom elements, HTML comments, spread shorthand
		const { template: processedTemplate, slotFns } = preprocess_template(template, this.viewsDir, this.ext, (content) => this.compile(
			content
		));

		// Compile: template directives -> async render function
		return _compile_to_code(processedTemplate, slotFns);
	}

	// HTML escape (single-pass)
	escape(str: any): string {
		if (str == null) return "";
		const s = String(str);
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
			/"/g,
			"&quot;"
		).replace(/'/g, "&#39;");
	}

	async include(name: string, props: Record<string, any>): Promise<string> {
		// layout() uses include from views root semantics
		return await this.render(name, props);
	}

	async render(name: string, props: Record<string, any> = {}): Promise<string> {
		const currentName = name; // used by relative includes within this template
		const lang = props?.lang;

		// Resolve localized variant if language is available:
		// {name}.{lang}.ree -> {name}.{default_language}.ree -> {name}.ree
		let resolvedName = name;
		let template: string;
		if (lang) {
			const result = await this.loadLocalized(name, lang);
			template = result.content;
			resolvedName = result.resolvedName;
		} else {
			template = await this.loadTemplate(name);
		}

		if (this.cache && this.compiledCache[resolvedName]) {
			const compiledFn = this.compiledCache[resolvedName];
			const boundInclude = this.include.bind(this);
			const rtInclude = this.includeResolved.bind(this, currentName);
			const escape = this.autoEscape ? this.escape.bind(this) : (s: any) => String(s ?? "");
			// @ts-expect-error - compiled function expects extra args via wrapper
			return await (compiledFn as any)(props, escape, boundInclude, rtInclude, currentName);
		}

		const compiledFn = this.compile(template);

		if (this.cache) { this.compiledCache[resolvedName] = compiledFn; }

		const boundInclude = this.include.bind(this);
		const rtInclude = this.includeResolved.bind(this, currentName);
		const escape = this.autoEscape ? this.escape.bind(this) : (s: any) => String(s ?? "");

		// @ts-expect-error
		return await (compiledFn as any)(props, escape, boundInclude, rtInclude, currentName);
	}

	async renderString(templateString: string, props: Record<string, any> = {}): Promise<string> {
		const compiledFn = this.compile(templateString);
		const currentName = ""; // treat renderString as views-root
		const boundInclude = this.include.bind(this);
		const rtInclude = this.includeResolved.bind(this, currentName);
		const escape = this.autoEscape ? this.escape.bind(this) : (s: any) => String(s ?? "");
		// @ts-expect-error
		return await (compiledFn as any)(props, escape, boundInclude, rtInclude, currentName);
	}

	clearCache(): void { this.compiledCache = {}; }

	async writeOutput(filePath: string, content: string): Promise<void> {
		const dir = dirname(filePath);
		if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
		await write(filePath, content);
	}
}

export default TemplateEngine;
