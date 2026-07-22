import { describe, expect, test } from "bun:test";

import { assert_mcp_mutation_enabled, filter_mcp_tools, has_mcp_mutation_capability } from "./capabilities";

describe("MCP mutation capability", () => {
	test("is disabled unless a local operator explicitly enables it", () => {
		expect(has_mcp_mutation_capability("")).toBe(false);
		expect(has_mcp_mutation_capability("false")).toBe(false);
		expect(has_mcp_mutation_capability("true")).toBe(true);
		expect(() => assert_mcp_mutation_enabled("")).toThrow();
		expect(() => assert_mcp_mutation_enabled("true")).not.toThrow();
	});

	test("hides mutation tools by default", () => {
		const tools = [
			{ name: "list_pages" },
			{ name: "run_ssg" },
			{ name: "set_translations" },
			{ name: "add_language" },
			{ name: "remove_language" },
		];

		expect(filter_mcp_tools(tools, "")).toEqual([{ name: "list_pages" }]);
		expect(filter_mcp_tools(tools, "true")).toEqual(tools);
	});
});
