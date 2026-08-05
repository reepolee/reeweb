/**
 * Names of the built-in template helpers injected as bare identifiers into
 * compiled templates.
 *
 * Custom helpers beyond this list remain available as `helpers.<name>`.
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
