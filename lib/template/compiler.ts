/**
 * Template Compiler - extracted from TemplateEngine.compile().
 *
 * Takes a preprocessed template string (with custom elements and comments
 * already resolved) and compiles it into an async function
 * that renders HTML at runtime.
 *
 * Handles:
 * - {= expr }        escaped output
 * - {~ expr }        unescaped output
 * - {{ ... }}        raw JS (double braces)
 * - {#layout(...)}   layout wrapping
 * - {#include(...)}  partial includes
 * - {#each} / {:else} / {/each} iteration
 * - {#if} / {:else} / {/if} conditionals
 * - {#with} / {/with} scope blocks
 * - Block stack state machine for nested structures
 * - new Function() code generation
 */

import type { CompiledFn } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlockEntry {
	type: "each" | "if" | "with";
	id?: number;
	hasElse: boolean;
}

interface LayoutInfo {
	name: string;
	data: string;
}

interface CompileState {
	blockStack: BlockEntry[];
	eachCounter: number;
}

// ---------------------------------------------------------------------------
// Directive call parser
// ---------------------------------------------------------------------------

/**
 * Parse a directive call string like:
 * layout('path', { expr })
 * include('path', { expr })
 *
 * Returns the first argument (string name) and the optional second argument
 * (a JS expression for data). Returns null on parse failure.
 */
function parse_call(s: string): { name: string; dataExpr: string; } | null {
	const openParenIdx = s.indexOf("(");
	if (openParenIdx < 0) return null;

	let i = openParenIdx + 1;
	const n = s.length;

	// Read first arg: quoted string
	while (i < n && /\s/.test(s[i])) i++;
	if (i >= n) return null;

	const quote = s[i];
	if (quote !== "'" && quote !== "\"" && quote !== "`") return null;
	i++; // after opening quote

	let name = "";
	let escaped = false;
	while (i < n) {
		const ch = s[i++];
		if (escaped) {
			name += ch;
			escaped = false;
		} else if (ch === "\\") {
			escaped = true;
		} else if (ch === quote) {
			break;
		} else {
			name += ch;
		}
	}
	if (i > n) return null;

	// Skip spaces
	while (i < n && /\s/.test(s[i])) i++;

	// Optional second arg
	if (i < n && s[i] === ",") {
		i++; // skip comma
		while (i < n && /\s/.test(s[i])) i++;
		let depthParen = 0, depthBrace = 0, depthBracket = 0;
		let inStr: string | null = null;
		let esc = false;
		let expr = "";
		while (i < n) {
			const ch = s[i++];
			expr += ch;

			if (inStr) {
				if (esc) {
					esc = false;
				} else if (ch === "\\") {
					esc = true;
				} else if (ch === inStr) {
					inStr = null;
				}
				continue;
			}

			if (ch === "\"" || ch === "'" || ch === "`") {
				inStr = ch;
				continue;
			}

			if (ch === "(") depthParen++; else if (ch === ")") {
				if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
					// This ')' closes the directive
					expr = expr.slice(0, -1); // drop this ')'
					const dataExpr = expr.trim() || "{}";
					return { name, dataExpr };
				}
				depthParen--;
			} else if (ch === "{") depthBrace++; else if (ch === "}") depthBrace--; else if (ch === "[") depthBracket++; else if (ch === "]") depthBracket--;
		}
		return null; // no closing paren
	} else {
		// No second arg: expect ')'
		while (i < n && /\s/.test(s[i])) i++;
		if (i >= n || s[i] !== ")") return null;
		return { name, dataExpr: "{}" };
	}
}

/**
 * Scan a prefix tag ({= ...}, {#layout(...)}, etc.) starting at the opening
 * brace, balancing nested braces and respecting string literals. The main
 * loop's non-greedy regex stops at the first "}", which truncates tags whose
 * content contains an object literal, e.g. {#layout('x', { title: 'y' })}.
 * Returns the full inner content (after the prefix char) and the index just
 * past the closing brace, or null if no balanced close exists.
 */
function scan_balanced_tag(s: string, start: number): { content: string; end: number; } | null {
	// s[start] === "{", s[start + 1] is the prefix char
	let depth = 1;
	let inStr: string | null = null;
	let esc = false;
	let i = start + 2;
	const n = s.length;
	while (i < n) {
		const ch = s[i];
		if (inStr) {
			if (esc) {
				esc = false;
			} else if (ch === "\\") {
				esc = true;
			} else if (ch === inStr) {
				inStr = null;
			}
		} else if (ch === "\"" || ch === "'" || ch === "`") {
			inStr = ch;
		} else if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				const content = s.slice(start + 2, i);
				return { content, end: i + 1 };
			}
		}
		i++;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Individual token handler functions
// ---------------------------------------------------------------------------

/**
 * Emit literal text between template tags.
 */
function emit_text(text: string): string { return `__output += ${JSON.stringify(text)};\n`; }

/**
 * Emit raw JS code block from {{ ... }}.
 */
function emit_code_block(rawJS: string): string { return `${rawJS}\n`; }

/**
 * Handle {#layout(...)} - stores layout info for post-processing.
 * Returns the LayoutInfo or null if parsing fails.
 */
function handle_layout(trimmedCall: string): LayoutInfo {
	const parsed = parse_call(trimmedCall);
	if (!parsed) {
		throw new Error(
			`Invalid layout syntax: "{#${trimmedCall}}". Expected {#layout('path'[, data])}`,
		);
	}
	return { name: parsed.name, data: parsed.dataExpr || "{}" };
}

/**
 * Handle {#include(...)} - emits an include call.
 */
function emit_include(trimmedCall: string): string {
	const parsed = parse_call(trimmedCall);
	if (!parsed) {
		throw new Error(
			`Invalid include syntax: "{#${trimmedCall}}". Expected {#include('path'[, data])}`,
		);
	}
	const partialName = parsed.name;
	const partialData = parsed.dataExpr || "{}";
	return `__output += await __rtInclude(${JSON.stringify(partialName)}, Object.assign({}, props, ${partialData}));\n`;
}

/**
 * Handle {#each ... as ...} - emits the JS for loop setup.
 */
function emit_each_open(trimmedContent: string, state: CompileState): string {
	const eachMatch = trimmedContent.match(
		/^each\s+(.*?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*$/
	);
	if (!eachMatch) {
		throw new Error(
			`Invalid #each syntax: "{#each ${trimmedContent}}". Expected "{#each <listExpr> as <item>[, index][, key] }"`,
		);
	}
	const listExpr = eachMatch[1];
	const itemVar = eachMatch[2];
	const indexVar = eachMatch[3];
	const keyVar = eachMatch[4];

	const id = state.eachCounter++;
	state.blockStack.push({ type: "each", id, hasElse: false });

	return `\n{\n  const __src_${id} = (${listExpr});\n  const __isArr_${id} = Array.isArray(__src_${id});\n  const __keys_${id} = __isArr_${id}\n    ? Array.from({ length: __src_${id} ? __src_${id}.length : 0 }, (_, i) => i)\n    : (__src_${id} && typeof __src_${id} === "object" ? Object.keys(__src_${id}) : []);\n\n  if (__keys_${id}.length > 0) {\n    for (let __i_${id} = 0; __i_${id} < __keys_${id}.length; __i_${id}++) {\n      const __k_${id} = __keys_${id}[__i_${id}];\n      const ${itemVar} = __src_${id} ? __src_${id}[__k_${id}] : undefined;\n      ${indexVar ? `const ${indexVar} = __i_${id};` : ""}\n      ${keyVar ? `const ${keyVar} = __k_${id};` : ""}\n`;
}

/**
 * Handle {#with ...} - emits the JS with() block setup.
 */
function emit_with_open(trimmedContent: string, state: CompileState): string {
	const expr = trimmedContent.replace(/^with\b/, "").trim();
	if (!expr) {
		throw new Error(
			`Invalid #with syntax: "{#with ${trimmedContent}}". Expected "{#with <expr> }"`,
		);
	}
	const id = state.eachCounter++;
	state.blockStack.push({ type: "with", id, hasElse: false });
	return `\n{\n  const __with$${id} = (${expr});\n  with (__with$${id}) {\n`;
}

/**
 * Handle {#if ...} - emits the JS if() block setup.
 */
function emit_if_open(trimmedContent: string, state: CompileState): string {
	const cond = trimmedContent.replace(/^if\b/, "").trim();
	if (!cond) {
		throw new Error(
			`Invalid #if syntax: "{#if ${trimmedContent}}". Expected "{#if <condition> }"`,
		);
	}
	state.blockStack.push({ type: "if", hasElse: false });
	return `\n{\n  let __if_result;\n  try { __if_result = (${cond}); } catch (__if_e) { __if_result = undefined; }\n  if (__if_result) {\n`;
}

/**
 * Handle {:else} - emits the else branch code.
 */
function emit_else(state: CompileState): string {
	if (state.blockStack.length === 0) {
		throw new Error("Unexpected {:else} without an open {#if} or {#each} block");
	}
	if (state.blockStack[state.blockStack.length - 1].type === "with") {
		throw new Error("{:else} is not allowed inside {#with} blocks");
	}
	const current = state.blockStack[state.blockStack.length - 1]!;
	if (current.hasElse) { throw new Error("Multiple {:else} in the same block are not allowed"); }
	current.hasElse = true;

	if (current.type === "each") {
		return `

    }
  } else {
`;
	} else if (current.type === "if") {
		return `
  } else {
`;
	}
	return "";
}

/**
 * Handle {/each} - closes an each block.
 */
function emit_close_each(state: CompileState): string {
	if (state.blockStack.length === 0 || state.blockStack[state.blockStack.length - 1].type !== "each") {
		throw new Error("Unexpected {/each} without a matching {#each}");
	}
	const blk = state.blockStack.pop()!;
	if (blk.hasElse) {
		return `
  }
}
`;
	} else {
		return `
    }
  }
}
`;
	}
}

/**
 * Handle {/with} - closes a with block.
 */
function emit_close_with(state: CompileState): string {
	if (state.blockStack.length === 0 || state.blockStack[state.blockStack.length - 1].type !== "with") {
		throw new Error("Unexpected {/with} without a matching {#with}");
	}
	state.blockStack.pop();
	return `
  }
}
`;
}

/**
 * Handle {/if} - closes an if block.
 */
function emit_close_if(state: CompileState): string {
	if (state.blockStack.length === 0 || state.blockStack[state.blockStack.length - 1].type !== "if") {
		throw new Error("Unexpected {/if} without a matching {#if}");
	}
	state.blockStack.pop();
	return `
  }
}
`;
}

/**
 * Handle {= expr} or {~ expr} - escaped/unescaped output expression.
 * Arbitrary JS. undefined/null renders as "" (via __escape); a genuinely
 * broken expression throws. For translation lookups with a missing-key
 * safety net, use {_ path} / {- path} / {@ path} instead (see
 * emit_translation_lookup); {@ } additionally renders the value as markdown.
 */
function emit_expression(prefix: string, content: string): string {
	switch (prefix) {
		case "=":
			return `__output += __escape(${content});\n`;
		case "~":
			return `\n{\n\tconst __tmp = (${content});\n\t__output += (typeof __tmp === "function" ? __tmp() : __tmp);\n}\n`;
		default:
			return `${content}\n`;
	}
}

// Restricted to a simple property path - dotted identifiers plus optional
// string-literal bracket segments (e.g. selectors?.["0"] for keys that are
// not valid identifiers). No arbitrary JS, no computed keys, no function
// calls. This is what makes {_ }/{- } safe to resolve via a plain property
// walk instead of eval-and-catch.
const DOTTED_PATH_RE = /^[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*|(?:\?\.)?\[(?:"[^"]*"|'[^']*')\])*$/;

/**
 * Handle {_ path} or {- path} - translation lookup, escaped/unescaped.
 * `path` is a restricted property path (e.g. "labels.text_input" or
 * "selectors?.[\"0\"]" for non-identifier keys), always resolved against
 * props.translations via a safe compile-time property walk - never
 * eval-and-catch. On a missing key, or when props.translations itself is
 * absent (legitimate mid-scaffolding, before translation keys are wired up),
 * renders `{last_segment}` instead of throwing or silently rendering empty -
 * same marker convention as mark_missing_from() in lib/i18n.ts and
 * nav_label() in template_helpers.ts.
 */
function emit_translation_lookup(prefix: string, content: string): string {
	const path = content.trim();
	if (!DOTTED_PATH_RE.test(path)) {
		throw new Error(
			`Invalid {${prefix} ${content}} syntax: expected a simple dotted path (e.g. "labels.text_input") or string-literal bracket keys (e.g. selectors?.["0"]), no expressions, computed keys, or function calls.`,
		);
	}

	// Tokenize into plain segments: identifiers and quoted bracket keys
	const segment_re = /[A-Za-z_$][\w$]*|\[(?:"([^"]*)"|'([^']*)')\]/g;
	const parts: string[] = [];
	let seg_match: RegExpExecArray | null;
	while ((seg_match = segment_re.exec(path)) !== null) {
		const bracket_key = seg_match[1] ?? seg_match[2];
		parts.push(bracket_key ?? seg_match[0]);
	}

	const last_segment = parts[parts.length - 1];
	const missing_literal = JSON.stringify(`{${last_segment}}`);

	const ident_re = /^[A-Za-z_$][\w$]*$/;
	const walk = parts.map((part) => (ident_re.test(part) ? `?.${part}` : `?.[${JSON.stringify(part)}]`)).join(
		""
	);
	const resolve_expr = `(props.translations${walk} ?? ${missing_literal})`;

	switch (prefix) {
		case "_":
			return `__output += __escape(${resolve_expr});\n`;
		case "-":
			return `\n{\n\tconst __tmp = ${resolve_expr};\n\t__output += (typeof __tmp === "function" ? __tmp() : __tmp);\n}\n`;
		case "@":
			// Translation lookup rendered through markdown to HTML. A missing key
			// resolves to the "{marker}" literal, which markdown wraps in a <p>.
			return `\n{\n\tconst __md_src = ${resolve_expr};\n\t__output += (__md_src == null || __md_src === "" ? "" : Bun.markdown.html(String(__md_src)));\n}\n`;
		default:
			throw new Error(`Unknown translation lookup prefix "${prefix}"`);
	}
}

// ---------------------------------------------------------------------------
// Main compiler entry points
// ---------------------------------------------------------------------------

/**
 * Compile a preprocessed template string into an async render function.
 *
 * @param processedTemplate - Template string after custom element and comment
 * preprocessing.
 * @param slotFns           - Compiled slot functions for custom elements.
 * @returns A CompiledFn that renders the template to HTML at runtime.
 */
export function compile_template(processedTemplate: string, slotFns: CompiledFn[]): CompiledFn {
	const { fn } = compile_to_code(processedTemplate, slotFns);
	return fn;
}

/**
 * Compile and return both the generated JS code and the compiled function.
 * Useful for debugging, introspection, and the MCP server's compile_template tool.
 */
export function compile_to_code(processedTemplate: string, slotFns: CompiledFn[]): { code: string; fn: CompiledFn; } {
	// Resolve ReeTag markers emitted by the pre-processor. Each marker encodes
	// the component tag name, slot id, and props object. We translate them to
	// raw-JS markers (\u0000J\u0000...\u0000) that the main loop recognizes and
	// emits via emit_code_block. Two-stage because the main loop's
	// balanced-brace-agnostic regexes can't safely parse these data payloads.
	// eslint-disable-next-line no-control-regex
	processedTemplate = processedTemplate.replace(/\u0000R\u0000([^\u0000]+)\u0000(\d+)\u0000([\s\S]*?)\u0000/g, (_match, tagName, _slotId, propsObj) => {
		const componentPath = `$components/${tagName}`;
		const js = `__output += await __rtInclude(${JSON.stringify(componentPath)}, Object.assign({}, props, ${propsObj}));\n`;
		return `\u0000J\u0000${js}\u0000\u0000`;
	});

	let code = "let __output = \"\";\n";
	code += "const { user, is_dev, lang, csrf_token, helpers = {} } = props;\n";
	let layoutResult: LayoutInfo | null = null;

	// eslint-disable-next-line no-control-regex
	const combinedPattern = /\{\{([\s\S]*?)\}\}|\{([~=#:/_@-])\s*([\s\S]*?)\}|\u0000J\u0000([\s\S]*?)\u0000\u0000/g;

	const state: CompileState = { blockStack: [], eachCounter: 0 };

	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = combinedPattern.exec(processedTemplate)) !== null) {
		const index = match.index;

		// Emit literal text between tags
		if (index > lastIndex) {
			const text = processedTemplate.slice(lastIndex, index);
			code += emit_text(text);
		}

		if (match[1] !== undefined) {
			// {{ ... }} - raw JS
			code += emit_code_block(match[1].trim());
		} else if (match[4] !== undefined) {
			// \u0000J\u0000...\u0000\u0000 - ReeTag-resolved raw JS statement
			code += match[4];
		} else if (match[2] !== undefined) {
			// {prefix ... } - directive or output with explicit prefix
			const prefix = match[2];
			let rawContent = match[3]!;

			// The non-greedy regex stops at the first "}", truncating tags whose
			// content contains braces (object literals in layout/include data,
			// {= {a:1}.a }, etc.). Rescan with brace balancing and extend the
			// match when the true closing brace is further out.
			const balanced = scan_balanced_tag(processedTemplate, index);
			if (balanced && balanced.end > combinedPattern.lastIndex) {
				rawContent = balanced.content;
				combinedPattern.lastIndex = balanced.end;
			}

			const trimmedContent = rawContent.trim();

			if (trimmedContent.startsWith("layout(") || trimmedContent.startsWith("include(")) {
				const parenIdx = trimmedContent.indexOf("(");
				const directiveName = trimmedContent.slice(0, parenIdx);
				const directiveContent = trimmedContent.slice(parenIdx);
				const trimmedCall = `${directiveName}${directiveContent}`;

				if (directiveName === "layout") {
					layoutResult = handle_layout(trimmedCall);
				} else if (directiveName === "include") {
					code += emit_include(trimmedCall);
				}
			} else if (prefix === "#" && trimmedContent.startsWith("each")) {
				code += emit_each_open(trimmedContent, state);
			} else if (prefix === "#" && /^with\b/.test(trimmedContent)) {
				code += emit_with_open(trimmedContent, state);
			} else if (prefix === "#" && /^if\b/.test(trimmedContent)) {
				code += emit_if_open(trimmedContent, state);
			} else if (prefix === ":" && trimmedContent === "else") {
				code += emit_else(state);
			} else if (prefix === "/" && trimmedContent === "each") {
				code += emit_close_each(state);
			} else if (prefix === "/" && trimmedContent === "with") {
				code += emit_close_with(state);
			} else if (prefix === "/" && trimmedContent === "if") {
				code += emit_close_if(state);
			} else if (prefix === "_" || prefix === "-" || prefix === "@") {
				code += emit_translation_lookup(prefix, trimmedContent);
			} else {
				code += emit_expression(prefix, trimmedContent);
			}
		}

		lastIndex = combinedPattern.lastIndex;
	}

	// Trailing literal text
	if (lastIndex < processedTemplate.length) {
		const text = processedTemplate.slice(lastIndex);
		code += emit_text(text);
	}

	// Ensure no unclosed blocks
	if (state.blockStack.length > 0) {
		const openTypes = state.blockStack.map((b) => b.type).join(", ");
		throw new Error(`Unclosed block(s): ${openTypes}`);
	}

	// Wrap layout if present
	if (layoutResult) {
		code = `\n${code}\nconst __body = __output;\nconst __layoutData = Object.assign({}, props, ${layoutResult.data}, { body: __body });\n__output = await __include(${JSON.stringify(
			layoutResult.name
		)}, __layoutData);\n`;
	}

	code += "return __output;";

	// Build async function
	let fn;
	try {
		const helper_vars = `const __h = (props?.helpers || {});
for (const [__hk, __hv] of Object.entries(__h)) {
  if (typeof __hv === 'function') {
    eval('var ' + __hk + ' = __hv');
  }
}`;

		fn = new Function("props", "__escape", "__include", "__rtInclude", "__currentName", "__slot_fns", `return (async () => {
const __run_slot = async (id, ...args) => {
	const fn = __slot_fns?.[id];
	return fn ? await fn(...args) : "";
};
${helper_vars}
${code}
})()`) as (props: Record<string, any>, __escape: (x: any) => string, __include: (n: string, d: Record<string, any>) => Promise<string>, __rtInclude: (n: string, d: Record<string, any>) => Promise<string>, __currentName: string) => Promise<string>;
	} catch (err) {
		console.error("=== Template Compilation Error ===");
		console.error("Generated code:");
		console.error(code);
		console.error("==================================");
		const errMsg = err instanceof Error ? err.message : String(err);
		throw new Error(`Template compilation failed: ${errMsg}`);
	}

	// Wrap to bind runtime helpers
	const compiled = async (props: Record<string, any>, escape: (x: any) => string, boundInclude: (n: string, d: Record<string, any>) => Promise<string>, rtInclude: (n: string, d: Record<string, any>) => Promise<string>, currentName: string) => {
		return await fn(props, escape, boundInclude, rtInclude, currentName, slotFns);
	};

	return { code, fn: compiled as unknown as CompiledFn };
}
