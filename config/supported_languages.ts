
// all translations
export const languages = ["en"] as const;

// language chooser from this list
export const active_languages = ["en"] as const;

// languages that are built but excluded from sitemap, feeds, hreflang, and chooser
export const soft_launch_languages: string[] = [];

// first served without selection
export const default_language = "en";

export const language_names: Record<string, string> = { en: "English" };

export const language_locales: Record<string, string> = { en: "en-US" };
