/**
 * Names of the built-in template helpers injected as bare identifiers into
 * compiled templates.
 *
 * Lives in its own dependency-free module so the compiler can embed the list
 * at compile time without importing template_helpers.
 *
 * Two-tier by design: this list is the injected system-helper set, and every
 * other helper stays reachable as `helpers.<name>`. This file is therefore
 * deliberately NOT in SHARED_ENGINE_FILES (scripts/engine_drift_check.ts) -
 * reepolee's list differing from this one is intended, not drift. Do not
 * "reconcile" the two lists, and do not add this file to the drift checker.
 *
 * A name listed here without an implementation in this project is a
 * not-yet-implemented system helper, not dead code.
 */
export const DEFAULT_HELPER_NAMES = [
	"url",
	"localized_path",
	"localized_path_for_locale",
	"nav_label",
	"is_current",
	"is_checked",
	"js_date_to_locale_string",
	"js_time_to_locale_string",
	"js_datetime_to_locale_string",
	"js_timestamp_to_locale_string",
	"js_date_to_iso_string",
	"js_datetime_to_iso_string",
	"js_timestamp_to_iso_string",
	"display_currency",
	"display_percent",
	"urlencode",
	"urldecode",
	"md",
	"pill",
	"tags",
	"yes_no",
	"human_bytes",
	"key_values",
	"image_thumbnail",
	"file_link",
	"file_icon_name",
] as const;
