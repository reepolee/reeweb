/**
 * MCP Server - translation maintenance tools.
 *
 * check_translations is a read-only report; set_translations, add_language,
 * and remove_language write JSON/config files and require
 * MCP_ENABLE_MUTATIONS=true (they are hidden from tools/list without it).
 */

import { add_language, check_translations, remove_language, set_translations } from "./translations";
import { json_content, type ToolDef } from "./types";

export const translation_tools: ToolDef[] = [
	{
		name: "check_translations",
		description: "Audit translations (read-only): per-folder cross-language key gaps, template-referenced keys missing from every language, and authored keys no template references (possible orphans - dynamic keys can be false positives).",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const report = await check_translations();
			return json_content(report);
		},
	},
	{
		name: "set_translations",
		description: "Insert or update translation entries in the owning {lang}.json files (indent-preserving). namespace is the folder relative to src/public ('' = global routes bundle, 'blog' = src/public/blog/{lang}.json). Requires MCP_ENABLE_MUTATIONS=true.",
		inputSchema: {
			type: "object",
			properties: {
				entries: {
					type: "array",
					description: "Translation entries to upsert",
					items: {
						type: "object",
						properties: {
							lang: {
								type: "string",
								description: "Language code (e.g. 'en', 'sl')",
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
						required: ["lang", "namespace", "key_path", "value"],
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
		name: "add_language",
		description: "Add a language: registers it in config/supported_languages.ts and seeds a {lang}.json next to every default-language file (values copied, route_name stripped). Translate the copies afterwards with set_translations. Requires MCP_ENABLE_MUTATIONS=true.",
		inputSchema: {
			type: "object",
			properties: {
				lang: { type: "string", description: "Language code (e.g. 'de', 'pt-br')" },
				name: {
					type: "string",
					description: "English display name (e.g. 'German'); defaults to the code",
				},
				locale: {
					type: "string",
					description: "Locale tag (e.g. 'de-DE'); defaults to the code",
				},
			},
			required: ["lang"],
		},
		handler: async (args) => {
			const result = await add_language(args.lang, args.name, args.locale);
			return json_content(result);
		},
	},
	{
		name: "remove_language",
		description: "Remove a language: deletes its {lang}.json files and unregisters it from config/supported_languages.ts. Refuses the default language; language-variant templates (page.xx.ree) are reported, not deleted. Requires MCP_ENABLE_MUTATIONS=true.",
		inputSchema: {
			type: "object",
			properties: { lang: { type: "string", description: "Language code to remove" } },
			required: ["lang"],
		},
		handler: async (args) => {
			const result = await remove_language(args.lang);
			return json_content(result);
		},
	},
];
