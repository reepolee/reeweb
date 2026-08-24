/**
 * scripts/ssg/markdown.ts
 *
 * Markdown source resolution helpers: locale-variant file lookup and
 * title extraction. The implementations live in scripts/shared/markdown_sources.ts
 * (shared with the dev server and sidebar); this module re-exports them for
 * the SSG phase.
 */

export { extract_md_title, resolve_md_file } from "../shared/markdown_sources";
