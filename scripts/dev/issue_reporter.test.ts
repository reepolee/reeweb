import { describe, expect, test } from "bun:test";

import { screenshot_asset_raw_url, screenshot_asset_url } from "./issue_reporter";

describe("issue reporter screenshot URLs", () => {
	test("uses the authenticated GitHub blob path for links", () => {
		expect(screenshot_asset_url("reepolee/ree-web", "github-assets/example.png")).toBe(
			"https://github.com/reepolee/ree-web/blob/screenshots/github-assets/example.png",
		);
	});

	test("uses the authenticated GitHub raw path for image sources", () => {
		expect(screenshot_asset_raw_url("reepolee/ree-web", "github-assets/example.png")).toBe(
			"https://github.com/reepolee/ree-web/raw/screenshots/github-assets/example.png",
		);
	});
});
