/**
 * config/redirects.ts
 *
 * Pretty-URL redirects for the site. Each entry maps a `from` path to a `to`
 * target. Applied at the edge by Cloudflare via the emitted `dist/_redirects`
 * file, with parallel HTML stubs for local preview and non-Cloudflare hosts.
 *
 * Rules:
 *  - `from` must start with "/"
 *  - last segment of `from` must NOT contain "." (no fake file extensions)
 *  - `from` is taken literally - no per-language fanout. Add a second entry
 *    if you want `/en/resume` to redirect too.
 *  - `from` paths are unique
 *  - `to` is either an internal path (e.g. `/files/resume.pdf`) or an absolute
 *    URL (`https://...`). Internal targets must exist in `dist/` after build.
 *  - `status` defaults to 301; override to 302 for temporary shortlinks
 */

export type Redirect = { from: string; to: string; status?: 301 | 302; };

export const redirects: Redirect[] = [
	// Example:
	// { from: "/resume", to: "/files/resume-2026-v3.pdf" },
	// { from: "/talk", to: "https://youtube.com/watch?v=...", status: 302 },
];
