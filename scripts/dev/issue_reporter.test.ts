import { describe, expect, test } from "bun:test";

import { normalize_issue_repos, screenshot_asset_raw_url, screenshot_asset_url } from "./issue_reporter";

describe("issue reporter repo list", () => {
	test("normalizes the array form and keeps declaration order", () => {
		expect(normalize_issue_repos(["reepolee/ree-web", "other/project"])).toEqual([
			"reepolee/ree-web",
			"other/project",
		]);
	});

	test("accepts the legacy single-string form as a one-element list", () => {
		expect(normalize_issue_repos("reepolee/ree-web")).toEqual(["reepolee/ree-web"]);
	});

	test("drops invalid and duplicate entries", () => {
		expect(normalize_issue_repos(["reepolee/ree-web", "not-a-repo", "reepolee/ree-web", ""])).toEqual([
			"reepolee/ree-web",
		]);
	});

	test("returns an empty list when nothing is configured", () => {
		expect(normalize_issue_repos(undefined)).toEqual([]);
	});
});

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
