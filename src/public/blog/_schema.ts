/**
 * src/public/blog/_schema.ts
 *
 * Content-collection schema for the `blog` folder. The mere presence of this
 * file auto-registers `blog/` as a collection: `scripts/ssg.ts` validates the
 * frontmatter of every blog entry against `schema` before rendering, and fails
 * the build loudly on any violation. Astro-in-spirit, but TypeScript (no YAML).
 *
 * Validated per physical `.md` file, including language variants
 * (`post.sl.md`, `post.en.md`). The route's own listing index (`blog/index.md`)
 * is excluded; a folder-per-post (`blog/my-post/index.md`) is included.
 *
 * `title` and `published_at` are REQUIRED: a blog entry missing either (or with
 * a wrong type / unparseable date) fails the build. The remaining fields are
 * optional but still type-checked. To make another field mandatory, drop its
 * `.optional()`; to relax a required one, add `.optional()`.
 */

import { z } from "$vendor/zod.min.js";

/** An author is either a bare name string or an object with at least a name. */
const author = z.union(
	[
		z.string().min(1),
		z.object({ name: z.string().min(1) }).passthrough(), // academic posts add department/affiliation/orcid/…
	]
);

export const schema = z.object(
	{
		title: z.string().min(1),
		published_at: z.coerce.date(), // required; accepts a Date or "YYYY-MM-DD"
		last_updated_at: z.coerce.date().optional(), // friendly alias for sitemap <lastmod>
		authors: z.array(author).optional(),
		author: author.optional(),
		description: z.string().optional(), // SEO/meta + listing/feed summary
		excerpt: z.string().optional(), // short blurb; alias for description in listings/feeds
		category: z.string().optional(), // presentational; passed through to the template
		layout: z.string().min(1).optional(),
		localize: z.boolean().optional(),
		noindex: z.boolean().optional(),
		rss: z.boolean().optional(),
		// Visibility (see lib/content_visibility.ts): a draft is built but hidden -
		// rendered + reachable by URL, yet absent from listings/RSS/sitemap and
		// noindexed. `published: false` is the inverse alias of `draft: true`.
		draft: z.boolean().optional(),
		published: z.boolean().optional(),
	}
).passthrough(); // allow built-in/per-post extras (abstract, keywords, doi, site_name, …)
