/**
 * ── Project markdown styling ─────────────────────────────────
 *
 * Tailwind class strings injected onto rendered markdown elements by
 * `process_docs_markdown()`. This is the project-specific presentation layer -
 * edit it freely to restyle docs/blog markdown.
 *
 * The generic pipeline (heading/TOC scan, syntax highlighting, external-link
 * handling) lives in `lib/markdown_docs.ts` and should NOT be modified, so it
 * stays upstream-upgradeable. Only the classes below are yours to change.
 */

import type { MarkdownStyles } from "$lib/markdown_docs";

export const markdown_styles: MarkdownStyles = {
	heading: (level) => {
		if (level === 1) return "font-display text-4xl italic mb-6 scroll-mt-30";
		if (level === 2) return "font-display text-3xl italic mt-12 mb-6 scroll-mt-30";
		return "font-semibold text-lg mt-8 mb-3 scroll-mt-30";
	},
	pre: "code-block relative rounded-xl overflow-hidden bg-code-bg border border-white/5 p-5 mb-6",
	anchor: "text-accent underline underline-offset-2 decoration-accent/40 hover:decoration-accent transition-colors",
	paragraph: "text-muted leading-relaxed mb-6",
	inline_code: "font-mono text-xs bg-warm px-1.5 py-0.5 rounded",
	blockquote: "border-l-4 border-accent pl-4 py-2 italic text-muted mb-6",
	// Loose-list handling: a list containing a code block (or blank lines
	// between items) becomes a loose list where each <li> wraps its text in a
	// block <p>. With `list-inside` that would drop the text below the number,
	// so `[&>li>p]:inline` keeps the first paragraph on the marker line - but it
	// also makes the <p> wrapping a standalone image inline, and an inline img
	// still sits inside that <p>'s line box, picking up leading-relaxed's
	// half-leading as visible space above/below it. `[&>li>p:has(img)]:block`
	// takes that one paragraph back to block display so the (block) img
	// controls its own spacing instead, and `:mt-3` gives it the same gap as a
	// nested <pre> gets from `[&_li>pre]:mt-3`.
	ul: "list-disc list-inside space-y-2 mb-6 text-muted [&>li>p]:inline [&_li>pre]:mt-3 [&>li>p:has(img)]:block [&>li>p:has(img)]:mt-3",
	ol: "list-decimal list-inside space-y-2 mb-6 text-muted [&>li>p]:inline [&_li>pre]:mt-3 [&>li>p:has(img)]:block [&>li>p:has(img)]:mt-3",
	li: "leading-relaxed",
	img: "block rounded-xl border border-divider mb-6",
	table: "w-full text-sm text-left border-collapse",
	table_wrapper: "mb-6 rounded-xl border border-divider overflow-hidden",
	thead: "bg-warm",
	tbody: "divide-y divide-divider",
	th: "px-4 py-3 font-semibold text-ink align-bottom",
	td: "px-4 py-3 align-top text-muted leading-relaxed wrap-anywhere",
};
