/**
 * MCP Server - translation maintenance tools.
 *
 * check_translations is a read-only report; set_translations, add_language,
 * and remove_language write JSON/config files and require
 * MCP_ENABLE_MUTATIONS=true (they are hidden from tools/list without it).
 */

import { add_locale, check_translations, remove_locale, set_translations } from "./translations";
import { json_content, type ToolDef } from "./types";

export const translation_tools: ToolDef[] = [
	{
		name: "check_translations",
		description: "Audit translations (read-only): per-folder cross-locale key gaps, template-referenced keys missing from every locale, and authored keys no template references (possible orphans - dynamic keys can be false positives).",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const report = await check_translations();
			return json_content(report);
		},
	},
	{
		name: "set_translations",
		description: "Insert or update translation entries in the owning {locale}.json files (indent-preserving). namespace is the folder relative to src/public ('' = global routes bundle, 'blog' = src/public/blog/{locale}.json). Requires MCP_ENABLE_MUTATIONS=true.",
		inputSchema: {
			type: "object",
			properties: {
				entries: {
					type: "array",
					description: "Translation entries to upsert",
					items: {
						type: "object",
						properties: {
							locale: {
								type: "string",
								description: "Lowercase BCP 47 locale code (e.g. 'en-us', 'sl-si')",
							},
							namespace: {
								type: "string",
								description: "Folder relative to src/public ('' for the global bundle, 'blog', 'docs/guides')",
							},
							key_path: {
								type: "string",
								description: "Dot-separated key path (e.g. 'ui.welcome_title', 'route_name')",
							},
							value: { type: "string", description: "Translated text" },
						},
						required: ["locale", "namespace", "key_path", "value"],
					},
				},
			},
			required: ["entries"],
		},
		handler: async (args) => {
			const result = await set_translations(args.entries);
			return json_content(result);
		},
	},
	{
		name: "add_locale",
		description: "Add a locale: registers it in config/supported_locales.ts and seeds a {locale}.json next to every default-locale file (values copied, route_name stripped). Translate the copies afterwards with set_translations. Requires MCP_ENABLE_MUTATIONS=true.",
		inputSchema: {
			type: "object",
			properties: {
				locale: { type: "string", description: "Lowercase BCP 47 locale (e.g. 'de-de', 'pt-br')" },
				name: {
					type: "string",
					description: "English display name (e.g. 'German'); defaults to the code",
				},
				alias_target: {
					type: "string",
					description: "An existing configured locale whose UI-string translations this locale should serve (locale_aliases), instead of seeding its own files",
				},
			},
			required: ["locale"],
		},
		handler: async (args) => {
			const result = await add_locale(args.locale, args.name, args.alias_target);
			return json_content(result);
		},
	},
	{
		name: "remove_locale",
		description: "Remove a locale: deletes its {locale}.json files and unregisters it from config/supported_locales.ts. Refuses the default locale; locale-variant templates (page.xx-xx.ree) are reported, not deleted. Requires MCP_ENABLE_MUTATIONS=true.",
		inputSchema: {
			type: "object",
			properties: { locale: { type: "string", description: "BCP 47 locale code to remove" } },
			required: ["locale"],
		},
		handler: async (args) => {
			const result = await remove_locale(args.locale);
			return json_content(result);
		},
	},
];
