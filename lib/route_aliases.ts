/**
 * lib/route_aliases.ts
 *
 * URL slugification and route path utilities.
 * Used by lib/static_site.ts for generating URL-safe route segments.
 */

/** Transliterate and normalize to URL-safe ASCII. */
export function slugify(text: string): string {
	if (!text) return "";
	return text.normalize("NFKD")
		.toLowerCase()
		.replace(/\p{Diacritic}/gu, "")
		.replace(/ß/g, "ss").replace(
			/æ/g,
			"ae"
		).replace(/œ/g, "oe").replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
}
