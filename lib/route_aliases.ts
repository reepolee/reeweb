/**
 * lib/route_aliases.ts
 *
 * URL slugification and route path utilities.
 * Used by lib/static_site.ts for generating URL-safe route segments.
 */

/**
 * Letters NFKD cannot decompose into "base + combining diacritic". Without an
 * explicit mapping these are not stripped of an accent, they vanish entirely -
 * "Łódź" would slug to "odz" and "Ærø" to "aer". Applied after NFKD and
 * lowercasing, before the ASCII filter.
 */
const SLUG_TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/ß/g, "ss"],
	[/æ/g, "ae"],
	[/œ/g, "oe"],
	[/ø/g, "o"],
	[/ł/g, "l"],
	[/đ/g, "d"],
	[/ð/g, "d"],
	[/þ/g, "th"],
	[/ħ/g, "h"],
	[/ı/g, "i"],
	[/ŋ/g, "n"],
	[/ŧ/g, "t"],
	[/ƶ/g, "z"],
];

/** Transliterate and normalize to URL-safe ASCII. */
export function slugify(text: string): string {
	if (!text) return "";

	let out = text.normalize("NFKD").toLowerCase().replace(/\p{Diacritic}/gu, "");

	for (const [pattern, replacement] of SLUG_TRANSLITERATIONS) {
		out = out.replace(pattern, replacement);
	}

	return out.replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
}
