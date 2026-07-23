/**
 * lib/template_helpers.ts
 *
 * Template helper functions available in .ree templates via the helpers object.
 * Designed for static site generation - no server, DB, or Temporal dependencies.
 */

import { default_language } from "$config/supported_languages";
import hljs from "$vendor/highlight.min";
import { register_ree_language } from "$lib/ree_language";
import { avif, jpeg, srcset, webp } from "$lib/images";
import { tw_merge } from "$lib/tw_merge";

// Register the `.ree` template language against the shared hljs singleton so
// `{~ highlight(code, "ree")}` and ```ree code blocks resolve it.
register_ree_language(hljs);

export type TemplateHelpers = Record<string, any>;

// ---------------------------------------------------------------------------
// Standalone helper functions
// ---------------------------------------------------------------------------

export function key_values(rest: Record<string, unknown>) {
	return Object.entries(rest).map(([key, value]) => {
		if (value === true) return key; // boolean attribute
		if (value === false || value == null) return ""; // skip
		return `${key}="${String(value)}"`;
	}).filter(Boolean).join(" ");
}

export function url(p: string): string { return p.startsWith("/") ? p : `/${p}`; }

export function localized_path(canonical_path: string, lang?: string): string {
	// In static build, this is overridden by the static builder with URL prefix logic
	const resolved_lang = lang || default_language;
	return `/${resolved_lang}${canonical_path}`;
}

export function nav_label(key: string, nav?: Record<string, any>): string {
	if (!nav || typeof nav !== "object") return `__${key}__`;
	const parts = key.split(".");
	let current: any = nav;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return `__${key}__`;
		current = current[part];
	}
	return current != null ? current : `__${key}__`;
}

export function is_current(url: string, request_url?: string): string {
	if (!request_url) return "nav-item";
	const url_norm = url.endsWith("/") ? url.slice(0, -1) : url;
	const current = request_url === url_norm || request_url.startsWith(url_norm + "/") || request_url.startsWith(
		url_norm + "?"
	);
	return current ? "font-bold nav-item current" : "nav-item";
}

function safe_date(date_input: string | Date): Date | null {
	if (!date_input) return null;
	const d = typeof date_input === "string" ? new Date(date_input) : date_input;
	return Number.isNaN(d.getTime()) ? null : d;
}

const PADDED_DATE: Intl.DateTimeFormatOptions = {
	day: "2-digit",
	month: "2-digit",
	year: "2-digit",
};

const PADDED_TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

const PADDED_DATETIME: Intl.DateTimeFormatOptions = { ...PADDED_DATE, ...PADDED_TIME };

const PADDED_TIMESTAMP: Intl.DateTimeFormatOptions = {
	...PADDED_DATE,
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
};

export function js_date_to_locale_string(date_input: string | Date, locale?: string): string {
	const d = safe_date(date_input);
	if (!d) return "";
	try {
		return d.toLocaleDateString(locale, PADDED_DATE);
	} catch {
		return "";
	}
}

export function js_time_to_locale_string(date_input: string | Date, locale?: string): string {
	const d = safe_date(date_input);
	if (!d) return "";
	try {
		return d.toLocaleTimeString(locale, PADDED_TIME);
	} catch {
		return "";
	}
}

export function js_datetime_to_locale_string(date_input: string | Date, locale?: string): string {
	const d = safe_date(date_input);
	if (!d) return "";
	try {
		return d.toLocaleString(locale, PADDED_DATETIME);
	} catch {
		return "";
	}
}

export function js_timestamp_to_locale_string(date_input: string | Date, locale?: string): string {
	const d = safe_date(date_input);
	if (!d) return "";
	try {
		return d.toLocaleString(locale, PADDED_TIMESTAMP);
	} catch {
		return "";
	}
}

export function js_date_to_iso_string(date_input: string | Date): string {
	const d = safe_date(date_input);
	if (!d) return "";
	return d.toISOString().slice(0, 10);
}

export function js_datetime_to_iso_string(date_input: string | Date): string {
	const d = safe_date(date_input);
	if (!d) return "";
	return d.toISOString().slice(0, 16).replace("T", " ");
}

export function js_timestamp_to_iso_string(date_input: string | Date): string {
	const d = safe_date(date_input);
	if (!d) return "";
	return d.toISOString().slice(0, 19).replace("T", " ");
}

export type YesNoType = "both" | "yes_only";

export function pill(text: string, class_name: string): string {
	return `<div class="${class_name}">${text}</div>`;
}

const PILL_YES_NO_LAYOUT = "pill-yes-no-layout";

export function yes_no(val: number, type: YesNoType = "yes_only", selectors?: Record<string, string>): string {
	const zero_class = type === "both" ? PILL_YES_NO_LAYOUT + " pill-no" : "bg-transparent";
	const one_class = PILL_YES_NO_LAYOUT + " pill-yes";

	const show_zero = type === "both" ? selectors?.["0"] ?? "" : "";
	const show_one = selectors?.["1"] ?? "";

	return val === 0 ? pill(show_zero, zero_class) + "</span>" : pill(show_one, one_class);
}

const PILL_TAG_LAYOUT = "pill-layout";

export function tags(val: string, color_class: string = "pill-default"): string {
	if (!val) return "";
	return val.split(",").map((t) => t.trim()).filter(Boolean).map((t) => pill(
		t,
		PILL_TAG_LAYOUT + " " + color_class
	)).join(" ");
}

// ---------------------------------------------------------------------------
// Syntax highlighting (SSR, no client JS needed)
// ---------------------------------------------------------------------------

/**
 * Highlight code via highlight.js at render time.
 * Returns the full `<pre><code>` HTML with highlighted spans.
 * Used in .ree templates via `{~ highlight(code, lang)}`.
 */
export function highlight(code: string, lang?: string): string {
	if (!code) return "";
	const normalized = String(code).replace(/\\\\n/g, "\n");
	let highlighted: string;
	if (lang && hljs.getLanguage(lang)) {
		highlighted = hljs.highlight(normalized, { language: lang, ignoreIllegals: true }).value;
	} else {
		highlighted = hljs.highlightAuto(normalized).value;
	}
	const lang_attr = lang ? ` language-${lang}` : "";
	return `<pre class="code-block relative rounded-xl overflow-hidden overflow-x-auto bg-code-bg border border-white/5 p-5"><code class="hljs${lang_attr}">${highlighted}</code></pre>`;
}

export function human_bytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let value = bytes;

	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}

	return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function urlencode(str: string): string { return encodeURIComponent(str ?? ""); }

export function urldecode(str: string): string { return decodeURIComponent(str ?? ""); }

export function display_currency(val: number, locale: string = "sl-SI", hide_zero = false, symbol = "€"): string {
	if (val == undefined) val = 0;
	if (hide_zero && val == 0) return "";
	const ret = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: "EUR",
		currencyDisplay: "code",
		useGrouping: "always",
	}).format(val);
	return ret.replace("EUR", symbol);
}

export function display_percent(val: number, locale: string = "en-US"): string {
	if (val == undefined) val = 0;
	return new Intl.NumberFormat(locale, {
		style: "percent",
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(val / 100);
}

// ---------------------------------------------------------------------------
// Default helpers factory
// ---------------------------------------------------------------------------

export function create_default_helpers(data: any = {}): TemplateHelpers {
	const lang = data.lang || default_language;
	const locale = data.locale;
	const nav = data.nav;
	const request_url = data.request_url;
	const selectors = data.selectors;

	return {
		url,
		localized_path: (canonical_path: string) => localized_path(canonical_path, lang),
		nav_label: (key: string) => nav_label(key, nav),
		is_current: (u: string) => is_current(u, request_url),
		js_date_to_locale_string: (date_input: string | Date, l: string = locale) => js_date_to_locale_string(
			date_input,
			l
		),
		js_time_to_locale_string: (date_input: string | Date, l: string = locale) => js_time_to_locale_string(
			date_input,
			l
		),
		js_datetime_to_locale_string: (datetime_input: string | Date, l: string = locale) => js_datetime_to_locale_string(
			datetime_input,
			l
		),
		js_timestamp_to_locale_string: (timestamp_input: string | Date, l: string = locale) => js_timestamp_to_locale_string(
			timestamp_input,
			l
		),
		js_date_to_iso_string,
		js_datetime_to_iso_string,
		js_timestamp_to_iso_string,
		display_currency: (val: number, l: string = locale, hide_zero = false, symbol = "€") => display_currency(
			val,
			l,
			hide_zero,
			symbol
		),
		display_percent: (val: number, l: string = locale) => display_percent(val, l),
		urlencode,
		urldecode,
		pill,
		tags,
		yes_no: (val: number, type: YesNoType = "yes_only") => yes_no(val, type, selectors),
		human_bytes,
		highlight,
		key_values,
		// Tailwind class merging with conflict resolution (tailwind-merge)
		tw_merge,
		// Responsive images (see scripts/prepare_images.ts + <responsive-image>)
		avif,
		webp,
		jpeg,
		srcset,
	};
}

export function create_template_helpers(data: any = {}, custom: Record<string, any> = {}): TemplateHelpers {
	return { ...create_default_helpers(data), ...custom };
}
