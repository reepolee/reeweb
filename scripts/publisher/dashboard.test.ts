import { describe, expect, test } from "bun:test";

import { render_dashboard } from "./dashboard";
import type { PublisherView } from "./runner";

describe("Publisher dashboard template", () => {
	test("replaces every dashboard placeholder", () => {
		const view: PublisherView = {
			status: "ready",
			branch: "main",
			head: "1234567890abcdef",
			clean: true,
			changes: [],
			error: "",
			output: ["render complete"],
			preview_running: true,
		};

		const html = render_dashboard(view, "http://localhost:3002/");

		expect(html).toContain("main at 12345678");
		expect(html).toContain("render complete");
		expect(html).toContain("http://localhost:3002/");
		expect(html).not.toMatch(/__[A-Z_]+__/);
	});
});
