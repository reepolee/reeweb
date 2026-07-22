/**
 * lib/ree_language.ts
 *
 * highlight.js language definition for ReeWeb `.ree` templates.
 *
 * A `.ree` file is HTML with a small set of curly-brace template constructs:
 *
 *   {= expr }              escaped output
 *   {~ expr }              raw / unescaped output
 *   {_ labels.name }       translation lookup
 *   {- descriptions.card } markdown translation lookup
 *   {{ const x = 123 }}    inline JavaScript block
 *   {#if cond } {:else} {/if}
 *   {#each items as item } {/each}
 *   {#layout("layout")} {#include(...)} {#with ...}
 *
 * Design: REE output/translation/block tags are begin/end modes bounded by `}`,
 * so one unterminated tag can't swallow the rest of the file. The `{{ ... }}`
 * block sub-languages into JavaScript. HTML tags, attributes and comments are
 * highlighted by markup modes defined explicitly below (not borrowed from
 * highlight.js's xml language, which loses its tag colouring when spread into a
 * foreign language). A `.ree` file thus reads like HTML with the template tags
 * coloured on top, per-token inside each tag.
 *
 * Registered once against the shared vendored `hljs` singleton so
 * `hljs.getLanguage("ree")` resolves in both the markdown pipeline
 * (lib/markdown_docs.ts) and the `highlight()` template helper
 * (lib/template_helpers.ts).
 */

// The block keywords that open with `{#...` and their matching `{/...` closers.
const block_keywords = "if|each|with|include|layout";

/**
 * highlight.js LanguageFn for `.ree`. `hljs` is the highlight.js instance
 * passed in at registration time (used here for its shared modes and COMMENT).
 */
export function ree_language(hljs: any) {
	// {{ ... }} inline JavaScript block - the only span construct; the body is
	// highlighted as JavaScript so it matches the rest of the site's JS blocks.
	const js_block = {
		scope: "meta",
		begin: /\{\{/,
		end: /\}\}/,
		subLanguage: "javascript",
	};

	// Shared inner modes for the JavaScript-ish expression body of a tag - so
	// `{#each more_tools as tool}` colours `more_tools`, `as` and `tool`
	// individually (like the VS Code grammar) instead of one flat keyword.
	const expr_contains = [
		hljs.QUOTE_STRING_MODE,
		hljs.APOS_STRING_MODE,
		hljs.C_NUMBER_MODE,
		{ scope: "keyword", match: /\bas\b/ },
		// Dotted property access: `props.posts`, `tool.href` - the leading
		// object as a variable, each `.member` as a property.
		{ scope: "variable", match: /\b[A-Za-z_$][\w$]*(?=\s*\.)/ },
		{ scope: "property", match: /(?<=\.)[A-Za-z_$][\w$]*/ },
	];

	// {= expr } and {~ expr } output expressions. The `{=`/`{~`/`}` delimiters
	// carry the template-variable scope; the expression inside is sub-scoped.
	const output_tag = {
		scope: "template-variable",
		begin: /\{[=~]/,
		end: /\}/,
		contains: expr_contains,
	};

	// {_ labels.name } and {- descriptions.card } translation lookups.
	const translation_tag = {
		scope: "string",
		begin: /\{[_-]\s/,
		end: /\}/,
	};

	// {#if ...}, {#each ... as ...}, {#layout(...)}, {#include(...)}, {#with ...}
	// The `{#name` opener is a keyword; the rest of the tag body is sub-scoped.
	const block_open = {
		begin: new RegExp(`\\{#(?:${block_keywords})\\b`),
		beginScope: "keyword",
		end: /\}/,
		contains: expr_contains,
	};

	// {:else}
	const block_else = { scope: "keyword", match: /\{:else\}/ };

	// {/if}, {/each}, {/with}
	const block_close = { scope: "keyword", match: new RegExp(`\\{/(?:${block_keywords})\\}`) };

	const ree_modes = [js_block, output_tag, translation_tag, block_open, block_else, block_close];

	// HTML support. Borrowing highlight.js's own xml `contains` array does not
	// work when spread into a foreign language - its tag modes rely on xml being
	// the active language and lose their tag/attribute colouring. So define the
	// markup modes explicitly here: comments, doctype/processing tags, and open
	// and close tags with `name` + `attr` sub-scopes. REE tags are allowed
	// inside a tag's attribute area too, so `title="{= x }"` still highlights.
	const html_comment = hljs.COMMENT(/<!--/, /-->/, { relevance: 10 });

	const html_string = {
		scope: "string",
		variants: [{ begin: /"/, end: /"/ }, { begin: /'/, end: /'/ }],
		contains: [output_tag, translation_tag],
	};

	const html_attr = { scope: "attr", match: /[A-Za-z_:][\w:.-]*(?=\s*=|\s|>|\/)/ };

	// <!DOCTYPE ...> and processing/meta tags like <?xml ... ?>.
	const html_meta = { scope: "meta", begin: /<![A-Za-z]/, end: />/ };

	// Opening tag: <name ...>  - the tag name is scoped, attributes and REE
	// tags inside attribute values are highlighted, and the tag ends at `>`.
	const html_open_tag = {
		scope: "tag",
		begin: /<(?=[A-Za-z])/,
		end: /\/?>/,
		contains: [
			{ scope: "name", match: /[A-Za-z][\w.-]*/ },
			html_attr,
			html_string,
			...ree_modes,
		],
	};

	// Closing tag: </name>
	const html_close_tag = {
		scope: "tag",
		begin: /<\/(?=[A-Za-z])/,
		end: />/,
		contains: [
			{ scope: "name", match: /[A-Za-z][\w.-]*/ },
		],
	};

	const html_modes = [html_comment, html_meta, html_close_tag, html_open_tag];

	return {
		name: "REE",
		aliases: ["ree"],
		case_insensitive: false,
		contains: [...ree_modes, ...html_modes],
	};
}

/**
 * Register the `ree` language against a highlight.js instance. Idempotent:
 * re-registration is harmless and simply overwrites the same definition, so
 * both importing modules can call this without coordination.
 */
export function register_ree_language(hljs: any): void {
	hljs.registerLanguage("ree", ree_language);
}
