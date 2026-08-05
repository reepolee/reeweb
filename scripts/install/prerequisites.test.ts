import { describe, expect, test } from "bun:test";

import { extract_version } from "./prerequisites";

describe("extract_version", () => {
	test("reads the ReeWeb highlight CDN package version", () => {
		const script = "curl -fsSL https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js";
		expect(extract_version(script, "@highlightjs/cdn-assets")).toBe("11.11.1");
	});
});
