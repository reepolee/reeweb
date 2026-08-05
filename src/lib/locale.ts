/**
 * Locale helpers - the one place that understands the shape of a locale code.
 *
 * Canonical storage/config form is all-lowercase ("en-us", "sl-si") - this is
 * the locale identity used everywhere internally: config, object keys,
 * filenames, URL segments, comparisons. BCP 47 tags are case-insensitive, so
 * lowercase remains a valid spelling (Intl accepts it directly). Matching
 * incoming values (request paths, user input) is still case-insensitive via
 * canonical_locale(), so "EN-US" and "en-us" both resolve.
 *
 * Conventional mixed-case BCP 47 ("en-US") is a presentation-only concern -
 * use format_bcp47() at output boundaries that expect it (hreflang, og:locale).
 *
 * Mirrors reepolee-dev's lib/locale.ts. The config is validated at first
 * import and fails loudly on any malformed locale, unknown alias, alias
 * chain, or aliased default.
 */

import { active_locales, default_locale, locale_aliases, locales } from "$config/supported_locales";

// BCP 47 language tag, lowercase (this codebase's canonical storage form).
// Accepts the common shapes: "en", "en-us", "zh-hant-tw", "es-419".
// Language: 2-3 lowercase letters. Subtags: 2-3 letters, or a script (4
// letters), or a region digit code (3 digits), separated by hyphens.
const LOCALE_SHAPE = /^[a-z]{2,3}(-([a-z]{2,3}|[a-z]{4}|\d{3}))*$/;

/** "de-at" -> "de" */
export function locale_language(locale: string): string {
	return locale.split("-")[0]!;
}

/** "de-at" -> "at" */
export function locale_region(locale: string): string {
	return locale.slice(locale.indexOf("-") + 1);
}

/** "de-at" -> "de-at" (URL/filename form - locale is already canonical-lowercase) */
export function locale_url_segment(locale: string): string {
	return locale;
}

/** "de-at" -> "de-AT" (conventional BCP 47 casing for presentation: hreflang, og:locale). */
export function format_bcp47(locale: string): string {
	return Intl.getCanonicalLocales(locale)[0] ?? locale;
}

/**
 * Case-insensitive match of any spelling ("de-AT", "DE-at") against the
 * configured locales. Returns the canonical (lowercase) form or null.
 */
export function canonical_locale(value: string | null | undefined): string | null {
	if (!value) return null;
	const lowered = value.toLowerCase();
	const found = (locales as readonly string[]).find((locale) => locale === lowered);
	return found ?? null;
}

/**
 * Resolve the locale whose UI strings (translations) serve this request.
 * Aliased locales (e.g. de-AT -> de-DE) share their target's strings;
 * everything else resolves to itself.
 */
export function resolve_ui_locale(locale: string): string {
	return locale_aliases[locale] ?? locale;
}

/** Locales that own translation files (alias targets and unaliased locales). */
export function unaliased_locales(): string[] {
	return (locales as readonly string[]).filter((locale) => !locale_aliases[locale]);
}

function assert_valid_locale_config(): void {
	const all = locales as readonly string[];
	if (all.length === 0) throw new Error("supported_locales: locales must not be empty");
	for (const locale of all) {
		if (!LOCALE_SHAPE.test(locale)) throw new Error(`supported_locales: "${locale}" is not a canonical lowercase BCP 47 locale (expected e.g. "en-us")`);
	}
	const unique = new Set(all);
	if (unique.size !== all.length) throw new Error("supported_locales: duplicate locales");
	for (const locale of active_locales as readonly string[]) {
		if (!all.includes(locale)) throw new Error(`supported_locales: active locale "${locale}" is not in locales`);
	}
	if (!all.includes(default_locale)) throw new Error(`supported_locales: default_locale "${default_locale}" is not in locales`);
	if (locale_aliases[default_locale]) throw new Error(`supported_locales: default_locale "${default_locale}" must not be aliased`);
	for (const [from, to] of Object.entries(locale_aliases)) {
		if (!all.includes(from)) throw new Error(`supported_locales: alias source "${from}" is not in locales`);
		if (!all.includes(to)) throw new Error(`supported_locales: alias target "${to}" is not in locales`);
		if (from === to) throw new Error(`supported_locales: alias "${from}" points at itself`);
		if (locale_aliases[to]) throw new Error(`supported_locales: alias chain "${from}" -> "${to}" -> "${locale_aliases[to]}" (targets must be unaliased)`);
	}
}

assert_valid_locale_config();
