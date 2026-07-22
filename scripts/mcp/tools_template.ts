/**
 * MCP Server - template tools.
 *
 * Tools around the .ree engine: render/validate/compile/analyze template
 * strings, list and read components and page files, and render a full page
 * through the real SSG print-url path.
 *
 * Rendering executes local code (templates, data loaders), so the render
 * tools require MCP_ENABLE_TEMPLATE_RENDER=true.
 */

import { existsSync } from "node:fs";

import TemplateEngine from "$lib/template_engine";
import { file } from "bun";

import {
	active_languages,
	default_language,
	language_locales,
	language_names,
	languages,
	soft_launch_languages,
} from "$config/supported_languages";
import { project_hooks } from "$root/src/lib/project_hooks";

import pkg from "../../package.json";
import { build_page_data } from "../shared/page_data";

import { render_page } from "./operations";
import { PUBLIC_DIR, resolve_template_file } from "./paths";
import { analyze_template, list_components } from "./project";
import { json_content, text_content, type ToolDef } from "./types";

function assert_template_rendering_enabled(): void {
	if (Bun.env.MCP_ENABLE_TEMPLATE_RENDER !== "true") {
		throw new Error(
			"Template rendering executes local code and requires MCP_ENABLE_TEMPLATE_RENDER=true",
		);
	}
}

const engine = new TemplateEngine({
	views: PUBLIC_DIR,
	cache: false,
	ext: ".ree",
	auto_escape: true,
});

/**
 * Preview render data assembled through the canonical build_page_data core so
 * MCP previews match real pages. Context-dependent parts (localized URLs,
 * hreflang, self-names) degrade to identity/empty values here.
 */
function default_template_data(user_data: Record<string, any>): Record<string, any> {
	const lang = typeof user_data.lang === "string" ? user_data.lang : default_language;
	const language_urls = Object.fromEntries(languages.map((l) => [
		l,
		l === default_language ? "" : `/${l}`,
	]));

	return build_page_data({
		lang,
		lang_url_prefix: language_urls[lang] ?? "",
		locale: language_locales[lang] ?? "",
		request_url: "/",
		canonical_path: "/",
		hreflang_links: [],
		site_name: pkg.name,
		is_dev: false,
		base_url: "/",
		site_url: "",
		year: new Date().getFullYear(),
		active_languages,
		soft_launch_languages,
		language_names,
		language_self_names: {},
		default_language,
		languages,
		language_urls,
		localized_url: (path) => path,
		helper_functions: project_hooks.helper_functions ?? {},
	}, user_data);
}

export const template_tools: ToolDef[] = [
	{
		name: "render_template",
		description: "Execute and render a .ree template string with synthetic preview data. Template data is accessed via props.xxx (e.g. {= props.site_name }). Requires MCP_ENABLE_TEMPLATE_RENDER=true. For a real page, prefer render_page.",
		inputSchema: {
			type: "object",
			properties: {
				template: { type: "string", description: "The .ree template content to render" },
				data: {
					type: "object",
					description: "Data object to pass to the template (common vars like lang, is_dev are auto-injected)",
					additionalProperties: true,
				},
			},
			required: ["template"],
		},
		handler: async (args) => {
			assert_template_rendering_enabled();
			const html = await engine.render_string(args.template, default_template_data(
				args.data || {}
			));
			return text_content(html);
		},
	},
	{
		name: "render_page",
		description: "Render one site route byte-identical to a full SSG build (real translations, layouts, data loaders, pagination). Pass a request path like '/', '/blog' or '/en/about'. Requires MCP_ENABLE_TEMPLATE_RENDER=true.",
		inputSchema: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "Request path starting with '/' (language prefix optional)",
				},
			},
			required: ["url"],
		},
		handler: async (args) => {
			assert_template_rendering_enabled();
			const result = await render_page(args.url);
			return json_content(result);
		},
	},
	{
		name: "validate_template",
		description: "Validate .ree template syntax without rendering - returns valid flag and any errors",
		inputSchema: {
			type: "object",
			properties: {
				template: { type: "string", description: "The .ree template content to validate" },
			},
			required: ["template"],
		},
		handler: async (args) => {
			try {
				engine.compile_to_code(args.template);
				return text_content(JSON.stringify({ valid: true, errors: [] }));
			} catch (e: any) {
				return text_content(JSON.stringify({ valid: false, errors: [e.message] }));
			}
		},
	},
	{
		name: "compile_template",
		description: "Compile a .ree template and show the generated JavaScript source code",
		inputSchema: {
			type: "object",
			properties: {
				template: { type: "string", description: "The .ree template content to compile" },
			},
			required: ["template"],
		},
		handler: async (args) => {
			try {
				const { code } = engine.compile_to_code(args.template);
				return text_content(code);
			} catch (e: any) {
				return text_content(
					`// Compilation error:\n// ${e.message}`
				);
			}
		},
	},
	{
		name: "analyze_template",
		description: "Analyze a .ree template and extract its structure - layout, includes, components, variables, translation keys, conditionals, loops",
		inputSchema: {
			type: "object",
			properties: {
				template: { type: "string", description: "The .ree template content to analyze" },
			},
			required: ["template"],
		},
		handler: async (args) => {
			const analysis = analyze_template(args.template);
			return json_content(analysis);
		},
	},
	{
		name: "list_components",
		description: "List all available .ree component files in src/components",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const components = list_components();
			return json_content({ components });
		},
	},
	{
		name: "get_component_source",
		description: "Read the source of a .ree component by name",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string", description: "Component name (without .ree extension)" } },
			required: ["name"],
		},
		handler: async (args) => {
			const component_path = resolve_template_file(`src/components/${args.name}.ree`);
			if (!existsSync(component_path)) { throw new Error(`Component "${args.name}" not found`); }
			const source = await file(component_path).text();
			return text_content(source);
		},
	},
	{
		name: "read_template_file",
		description: "Read a .ree or .md page/component file under src/public or src/components.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Project-relative path (e.g. 'src/public/index.ree', 'src/components/my-h1.ree').",
				},
			},
			required: ["path"],
		},
		handler: async (args) => {
			const template_path = resolve_template_file(args.path);
			if (!existsSync(template_path)) { throw new Error(`Template file not found: ${args.path}`); }
			const source = await file(template_path).text();
			return text_content(source);
		},
	},
];
