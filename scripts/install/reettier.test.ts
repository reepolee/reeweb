import { describe, expect, test } from "bun:test";

import { normalize_reettier_version } from "./reettier";

describe("normalize_reettier_version", () => test("makes Cargo and release versions comparable", () => {
	expect(normalize_reettier_version("26.7.1")).toBe("26.07.1");
	expect(normalize_reettier_version("26.07.1")).toBe("26.07.1");
}));
