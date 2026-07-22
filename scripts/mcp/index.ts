#!/usr/bin/env bun
/**
 * MCP Server for reeweb (static site generator)
 *
 * Main entry point - wires together the MCP submodules and starts the server.
 *
 * ## Template tools (tools_template.ts)
 * - render_template       Render a .ree template string with preview data
 * - render_page           Render one site route exactly as the SSG builds it
 * - validate_template     Check .ree template syntax without rendering
 * - compile_template      Show the generated JavaScript for a .ree template
 * - analyze_template      Extract structure (layout, includes, variables, translation keys)
 * - list_components       List available .ree components (src/components)
 * - get_component_source  Read a component's .ree source
 * - read_template_file    Read a .ree/.md file under src/public or src/components
 * ## Project tools (tools_project.ts)
 * - get_project_context   Read AGENTS.md (project index) for full context
 * - list_pages            List all site pages with routes, namespaces, variants
 * - get_page_detail       Files, frontmatter, and localized URLs for one page
 * - get_route_map         Canonical route → localized output URL per language
 * - list_translations     Languages and translation namespaces (JSON files)
 * - get_translations      Translation tree for a language / namespace
 * - get_config            Languages, pagination, redirects, counts
 * - search_code           Search the codebase with ripgrep
 * - run_tests             Run project tests
 * - validate_content      Collections + .ree/.md collision checks (read-only)
 * - run_ssg               Full static build to dist/ (MCP_ENABLE_MUTATIONS=true)
 * - remove_demo_routes    Delete template demo content (homepage, about, contact, blog samples, docs)
 * ## Translation tools (tools_translations.ts)
 * - check_translations    Cross-language gaps, missing keys, orphans (read-only)
 * - set_translations      Upsert entries into {lang}.json files
 * - add_language          Register + seed a new language
 * - remove_language       Unregister + delete a language's JSON files
 *
 * Rendering tools require MCP_ENABLE_TEMPLATE_RENDER=true (they execute local
 * code); run_ssg, set_translations, add_language, and remove_language require
 * MCP_ENABLE_MUTATIONS=true (they write to the working tree).
 *
 * Communication: stdio (MCP / JSON-RPC 2.0 protocol)
 * Start: bun run mcp
 */

import pkg from "../../package.json";

import { filter_mcp_tools } from "./capabilities";
import { COMPONENTS_DIR, PROJECT_ROOT, PUBLIC_DIR } from "./paths";
import { list_components } from "./project";
import { project_tools } from "./tools_project";
import { template_tools } from "./tools_template";
import { translation_tools } from "./tools_translations";

const SERVER_VERSION = pkg.version;

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function json_rpc(id: any, result: any): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}

function json_rpc_error(id: any, code: number, message: string, data?: any): string {
	return `${JSON.stringify({
		jsonrpc: "2.0",
		id,
		error: { code, message, data },
	})}\n`;
}

function json_rpc_notification(method: string, params?: any): string {
	return `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const exposed_tools = filter_mcp_tools([...template_tools, ...project_tools, ...translation_tools]);

const tool_map = new Map();
for (const t of exposed_tools) {
	tool_map.set(t.name, t.handler);
}

function get_tool_schemas() {
	return exposed_tools.map(({ name, description, inputSchema }) => ({
		name,
		description,
		inputSchema,
	}));
}

/**
 * Run a tool handler with console.log diverted to stderr: stdout carries the
 * JSON-RPC stream, and in-process tools import project code that may log.
 */
async function run_tool(handler: (args: Record<string, any>) => Promise<any>, args: Record<string, any>): Promise<any> {
	const orig_log = console.log;
	console.log = console.error;
	try {
		return await handler(args);
	} finally {
		console.log = orig_log;
	}
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handle_message(msg: any): Promise<void> {
	const { jsonrpc, id, method, params } = msg;

	if (jsonrpc !== "2.0") {
		if (id) console.error(json_rpc_error(id, -32600, "Invalid Request: not JSON-RPC 2.0"));
		return;
	}

	switch (method) {
		case "initialize":
			{
				const response = json_rpc(id, {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "reeweb", version: SERVER_VERSION },
				});
				process.stdout.write(response);
				break;
			}
		case "notifications/initialized":
			{
				// No-op - client confirmed initialization
				break;
			}
		case "tools/list":
			{
				const response = json_rpc(id, { tools: get_tool_schemas() });
				process.stdout.write(response);
				break;
			}
		case "tools/call":
			{
				const { name, arguments: args } = params || {};
				const handler = tool_map.get(name);
				if (!handler) {
					process.stdout.write(json_rpc_error(id, -32601, `Tool not found: ${name}`));
					break;
				}
				try {
					const result = await run_tool(handler, args || {});
					process.stdout.write(json_rpc(id, result));
				} catch (e: any) {
					process.stdout.write(json_rpc_error(id, -32603, `Tool error: ${e.message}`, {
						stack: e.stack,
					}));
				}
				break;
			}
		case "notifications/cancelled":
		case "notifications/exit":
			{ process.exit(0); }
		default:
			{
				if (id) { process.stdout.write(json_rpc_error(id, -32601, `Method not found: ${method}`)); }
				break;
			}
	}
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
	console.error(`[reeweb-mcp] Project root: ${PROJECT_ROOT}`);
	console.error(`[reeweb-mcp] Pages: ${PUBLIC_DIR}`);
	console.error(`[reeweb-mcp] Components: ${COMPONENTS_DIR} (${list_components().length} loaded)`);
	console.error(`[reeweb-mcp] Tools registered: ${exposed_tools.length}`);

	process.stdout.write(json_rpc_notification("server/capabilities", {
		serverInfo: { name: "reeweb", version: SERVER_VERSION },
	}));

	const decoder = new TextDecoder();
	let leftover = "";

	for await (const chunk of Bun.stdin.stream()) {
		const text = decoder.decode(chunk, { stream: true });
		const parts = (leftover + text).split("\n");
		leftover = parts.pop() || "";

		for (const part of parts) {
			const trimmed = part.trim();
			if (!trimmed) continue;
			try {
				const msg = JSON.parse(trimmed);
				await handle_message(msg);
			} catch (e: any) {
				console.error(`[reeweb-mcp] Parse error: ${e.message}`);
			}
		}
	}
}

main().catch((err) => {
	console.error("[reeweb-mcp] Fatal:", err);
	process.exit(1);
});
