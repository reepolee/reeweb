import { describe, expect, test } from "bun:test";

import { parse_vips_version } from "./vips";

describe("parse_vips_version", () => {
	test("extracts the version reported by vips -v", () => {
		expect(parse_vips_version("vips-8.18.4")).toBe("8.18.4");
	});

	test("returns null for unusable output", () => {
		expect(parse_vips_version("vips is unavailable")).toBeNull();
	});
});
