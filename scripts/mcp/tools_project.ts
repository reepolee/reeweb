/**
 * MCP Server - project and operations tools.
 *
 * Project-state introspection (pages, route map, translations, config, code
 * search) and operations (tests, content validation, full SSG build).
 */

import {
	get_page_detail,
	get_project_config,
	get_route_map,
	get_translations_for,
	list_pages,
	list_translation_namespaces,
	read_project_file,
	search_code,
} from "./project";
import { run_project_tests, run_ssg, validate_content } from "./operations";
import { json_content, text_content, type ToolDef } from "./types";
import { remove_demo_content } from "../shared/demo_content";

export const project_tools: ToolDef[] = [
	{
		name: "get_project_context",
		description: "Read AGENTS.md - the project index: conventions, commands, doc map, architecture pointers",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const text = await read_project_file("AGENTS.md");
			if (!text) { throw new Error("AGENTS.md not found at project root."); }
			return text_content(text);
		},
	},
	{
		name: "list_pages",
		description: "List all site pages (.ree and .md under src/public) with canonical route, kind, translation namespace, draft flag, language-variant files, and data-loader presence",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const pages = list_pages();
			return json_content({ pages, total: pages.length });
		},
	},
	{
		name: "get_page_detail",
		description: "Get detailed info about one page by canonical route (e.g. '/about') - files, frontmatter, localized URLs per language, pagination flag",
		inputSchema: {
			type: "object",
			properties: {
				route: {
					type: "string",
					description: "Canonical route (e.g. '/', '/about', '/blog') or page file path",
				},
			},
			required: ["route"],
		},
		handler: async (args) => {
			const detail = await get_page_detail(args.route);
			return json_content(detail);
		},
	},
	{
		name: "get_route_map",
		description: "Map every canonical route to its localized output URL per language (route_name substitution + language prefix), as built by the SSG",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const routes = await get_route_map();
			return json_content({ routes, total: Object.keys(routes).length });
		},
	},
	{
		name: "list_translations",
		description: "List configured languages and their top-level translation namespaces (from the per-language JSON files under src/public)",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const languages = await list_translation_namespaces();
			return json_content({ languages });
		},
	},
	{
		name: "get_translations",
		description: "Get the merged translation tree for a language, optionally narrowed to a dot-separated namespace (e.g. 'routes', 'blog', 'routes.ui')",
		inputSchema: {
			type: "object",
			properties: {
				lang: { type: "string", description: "Language code (e.g. 'en', 'sl')" },
				namespace: {
					type: "string",
					description: "Optional dot-separated namespace path. If omitted, returns the full tree for the language.",
				},
			},
			required: ["lang"],
		},
		handler: async (args) => {
			const translations = await get_translations_for(args.lang, args.namespace);
			return json_content(translations);
		},
	},
	{
		name: "get_config",
		description: "Show project configuration - languages (all/active/default/soft-launch), pagination, redirects, page/component counts",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const config = await get_project_config();
			return json_content(config);
		},
	},
	{
		name: "search_code",
		description: "Search authored project code with ripgrep. Secrets, VCS metadata, dependencies, dist, and archives are excluded.",
		inputSchema: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Search pattern (supports regex)" },
				glob: {
					type: "string",
					description: "Optional file glob filter (e.g. '*.ts', '*.ree', '*.json')",
				},
				max_results: {
					type: "number",
					description: "Optional max results (default 50, max 200)",
				},
			},
			required: ["pattern"],
		},
		handler: async (args) => {
			const max_results = Math.min(args.max_results || 50, 200);
			const result = await search_code(args.pattern, args.glob, max_results);
			return json_content(result);
		},
	},
	{
		name: "run_tests",
		description: "Run project tests with bun test. Optionally filter by file path substring (e.g. 'scripts/mcp', 'pagination').",
		inputSchema: {
			type: "object",
			properties: {
				filter: { type: "string", description: "Optional test file filter" },
				timeout: {
					type: "number",
					description: "Optional timeout in seconds (default 120)",
				},
			},
		},
		handler: async (args) => {
			const result = await run_project_tests(args.filter, args.timeout || 120);
			return json_content(result);
		},
	},
	{
		name: "validate_content",
		description: "Validate site content without building: content-collection frontmatter against their _schema.ts Zod schemas, plus .ree/.md route collisions. Read-only.",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const result = await validate_content();
			return json_content(result);
		},
	},
	{
		name: "run_ssg",
		description: "Run the full static site build (scripts/ssg.ts) - clears and rewrites dist/. Requires MCP_ENABLE_MUTATIONS=true. Does not run the image/CSS/sitemap/RSS steps of 'bun run ssg'.",
		inputSchema: {
			type: "object",
			properties: {
				timeout: {
					type: "number",
					description: "Optional timeout in seconds (default 300)",
				},
			},
		},
		handler: async (args) => {
			const result = await run_ssg(args.timeout || 300);
			return json_content(result);
		},
	},
	{
		name: "remove_demo_routes",
		description: "Delete the template's demo content (starter homepage, about, contact, sample blog posts, docs pages) and strip their translation keys and layout nav links. Run once when starting a real project from this template. No dry-run - deletion is immediate; recover with git if needed.",
		inputSchema: { type: "object", properties: {} },
		handler: async () => {
			const result = remove_demo_content();
			return json_content(result);
		},
	},
];
