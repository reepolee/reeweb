/**
 * Custom element pre-processor - extracted from TemplateEngine.compile().
 *
 * Handles two pre-processing steps that run before the main compiler pass:
 * 1. HTML comment stripping:  <!-- ... --> is removed so directives inside comments are NOT compiled
 * 2. Custom HTML element shorthand:  <tag-name attr="val">SLOT</tag-name> -> \u0000R\u0000 marker (resolved by compile_to_code)
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import type { CompiledFn } from "./types";

// Same restriction as emit_translation_lookup in compiler.ts - a simple dotted
// identifier path only, no arbitrary JS, no computed keys, no function calls.
const DOTTED_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/**
 * Build the same safe, missing-key-tolerant resolution expression
 * emit_translation_lookup (compiler.ts) produces for {_ path}/{- path} -
 * duplicated here because ReeTag attributes are parsed into a raw JS object
 * literal by a separate code path that runs before the main tokenizer loop.
 */
function translation_lookup_expr(path: string): string {
	const trimmed = path.trim();
	if (!DOTTED_PATH_RE.test(trimmed)) {
		throw new Error(
			`Invalid {_ ${path}} / {- ${path}} syntax in attribute: expected a simple dotted path (e.g. "labels.text_input"), no expressions, computed keys, or function calls.`,
		);
	}
	const parts = trimmed.split(".");
	const last_segment = parts[parts.length - 1];
	const missing_literal = JSON.stringify(`{${last_segment}}`);
	const walk = parts.map((part) => `?.${part}`).join("");
	return `(props.translations${walk} ?? ${missing_literal})`;
}

/**
 * Parse HTML attributes string into a JS object literal fragment.
 * Extracted from the inner function in TemplateEngine.compile().
 *
 * Supports three kinds of attribute tokens:
 * 1. Standard key="val" / key='val' / boolean attributes
 * 2. Interpolated attrs: key="{= expr }" / key="{~ expr }" (strips braces, emits raw expr)
 * 3. Translation lookups: key="{_ path }" / key="{- path }" (safe dotted-path resolution)
 * 4. Spread shorthand: ...identifier - emits a JS spread operator in the object literal,
 *    e.g. <my-h1 ...p class="foo"> → attributes: { ...p, "class": "foo" }
 */
export function parse_attributes(attrStr: string): string {
	if (!attrStr?.trim()) return "";
	const parts: string[] = [];

	// First, extract spread tokens (e.g. ...p, ...rest).
	// These become JS spread operators in the generated object literal,
	// placed before explicit attrs so literal attrs override spread properties
	// (matching HTML's last-wins attribute semantics).
	//
	// We emit ...(identifier) with parentheses to prevent step 3's spread
	// shorthand conversion (which matches bare ...identifier -> {~ key_values(id)})
	// from matching inside the NUL-bounded ReeTag marker payload.
	// ...(identifier) is valid JS - the parens are just an expression wrapper.
	const spreadRegex = /\.\.\.([A-Za-z_$][\w$]*)/g;
	let sm: RegExpExecArray | null;
	while ((sm = spreadRegex.exec(attrStr)) !== null) {
		parts.push(`...(${sm[1]})`);
	}

	// Remove spread tokens before parsing regular attributes
	const cleanedAttrStr = attrStr.replace(spreadRegex, "").trim();

	const attrRegex = /([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
	let m: RegExpExecArray | null;
	while ((m = attrRegex.exec(cleanedAttrStr)) !== null) {
		const name = m[1];
		const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : true;
		if (value === true) {
			parts.push(`"${name}": true`);
		} else if (typeof value === "string" && /^\{[=~]\s+/.test(value) && value.endsWith("}")) {
			// Template expression inside attr - strip {= } / {~ } and emit as raw JS expression
			// e.g. title="{= ui.reset_btn }" -> "title": ui.reset_btn (evaluated at render time)
			const expr = value.slice(2, -1).trim();
			parts.push(`"${name}": ${expr}`);
		} else if (typeof value === "string" && /^\{[_-]\s+/.test(value) && value.endsWith("}")) {
			// Translation lookup inside attr - {_ ui.reset_btn } / {- ui.reset_btn }
			// e.g. title="{_ ui.reset_btn }" -> "title": (props.translations?.ui?.reset_btn ?? "{reset_btn}")
			const path = value.slice(2, -1).trim();
			parts.push(`"${name}": ${translation_lookup_expr(path)}`);
		} else {
			parts.push(`"${name}": ${JSON.stringify(value)}`);
		}
	}
	return parts.join(", ");
}

export type PreprocessResult = { template: string; slotFns: CompiledFn[]; };

export function preprocess_template(template: string, viewsDir: string, ext: string, compileSlot: (content: string) => CompiledFn): PreprocessResult {
	// Step 1: Strip HTML comments
	// Remove <!-- ... --> before any directive processing, so that
	// {= }, {~ }, {#if}, etc. inside comments are NOT evaluated.
	// This allows generators to emit commented-out CU fields without
	// crashing on missing columns/fields at render time.
	template = template.replace(/<!--[\s\S]*?-->/g, "");

	const slotFns: CompiledFn[] = [];

	// Step 2: Process custom HTML elements
	// <tag-name attr1="val1">SLOT</tag-name>
	// -> \u0000R\u0000<tag-name>\u0000<slotId>\u0000<propsObj>\u0000
	// (resolved by compile_to_code into a __rtInclude call)
	//
	// If the tag has a matching component file under components/, it becomes a
	// component call. If not, it's passed through as a native HTML element.
	const custElemRegex = /<([a-zA-Z][a-zA-Z0-9]*-[a-zA-Z0-9-]*)(?:\s([^>]*?))?\s*>([\s\S]*?)<\/\1>/g;
	let processedTemplate = template;

	while (true) {
		custElemRegex.lastIndex = 0;
		const match = custElemRegex.exec(processedTemplate);
		if (!match) break;

		const tagName = match[1];
		const attrStr = match[2] ?? "";
		const slotContent = match[3];

		// Check if a matching component file exists under components/
		const projectRoot = dirname(viewsDir);
		const componentFilePath = join(projectRoot, "components", tagName + ext);
		const componentExists = existsSync(componentFilePath);

		if (componentExists) {
			// Component found -> emit a NUL-bounded ReeTag marker that
			// compile_to_code resolves to a direct __rtInclude call. We use a
			// NUL marker instead of {#include(...)} because the directive
			// regex can't parse balanced-brace data expressions.
			// Format: \u0000R\u0000<tagName>\u0000<slotId>\u0000<propsObj>\u0000
			const slotId = slotFns.length;

			// Recursively compile the slot content as a standalone template
			const slotCompiledFn = compileSlot(slotContent);
			slotFns.push(slotCompiledFn);

			const attrs = parse_attributes(attrStr);
			const childrenExpr = `children: await __run_slot(${slotId}, props, __escape, __include, __rtInclude, __currentName)`;
			const propsObj = attrs ? `{${childrenExpr}, attributes: {${attrs}}}` : `{${childrenExpr}}`;

			const marker = `\u0000R\u0000${tagName}\u0000${slotId}\u0000${propsObj}\u0000`;
			processedTemplate = processedTemplate.slice(0, match.index) + marker + processedTemplate.slice(
				match.index + match[0].length
			);
		} else {
			// No component file - pass through as a native HTML element.
			const tagNameJson = JSON.stringify(tagName);

			// Handle spread tokens (e.g. ...p, ...rest) in the attribute string.
			// Extract them and generate key_values() calls in the output so the
			// object's properties become HTML attributes at render time.
			const spreadRegex = /\.\.\.([A-Za-z_$][\w$]*)/g;
			const spreadIds: string[] = [];
			const cleanedAttrStr = attrStr.replace(spreadRegex, (_match: string, id: string) => {
				spreadIds.push(id);
				return "";
			}).trim();

			// Build the attribute output: key_values() calls for each spread,
			// then literal attrs. Spreads come first (matching component case ordering).
			const attrParts: string[] = [];
			for (const id of spreadIds) {
				attrParts.push(`" " + key_values(${id})`);
			}
			if (cleanedAttrStr) { attrParts.push(JSON.stringify(` ${cleanedAttrStr}`)); }
			const attrOutput = attrParts.length > 0 ? attrParts.join(" + ") : JSON.stringify("");

			const replacement = `{{ __output += "<" + ${tagNameJson} + ${attrOutput} + ">"; }}${slotContent}{{ __output += "</" + ${tagNameJson} + ">"; }}`;
			processedTemplate = processedTemplate.slice(0, match.index) + replacement + processedTemplate.slice(
				match.index + match[0].length
			);
		}
	}

	return { template: processedTemplate, slotFns };
}
