// all locales
export const locales = ["en-us"] as const;

// locale chooser from this list
export const active_locales = ["en-us"] as const;

// locales that are built but excluded from sitemap, feeds, hreflang, and chooser
export const soft_launch_locales: string[] = [];

// first served without selection
export const default_locale = "en-us";

export const locale_names: Record<string, string> = { "en-us": "English" };

export const locale_aliases: Record<string, string> = {};
