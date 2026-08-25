import { describe, expect, test } from "bun:test";

import { slugify } from "$lib/route_aliases";

describe("slugify", () => {
	test("returns an empty string for empty input", () => {
		expect(slugify("")).toBe("");
	});

	test("lowercases and hyphenates", () => {
		expect(slugify("About Us")).toBe("about-us");
		expect(slugify("  Trim  Me  ")).toBe("trim-me");
	});

	test("strips combining diacritics via NFKD", () => {
		expect(slugify("Über uns")).toBe("uber-uns");
		expect(slugify("Čevljarska ulica")).toBe("cevljarska-ulica");
		expect(slugify("Ça va")).toBe("ca-va");
		expect(slugify("Åre")).toBe("are");
	});

	test("transliterates the documented ligature exceptions", () => {
		expect(slugify("Straße")).toBe("strasse");
		expect(slugify("Œuvre")).toBe("oeuvre");
	});

	test("transliterates letters NFKD cannot decompose instead of dropping them", () => {
		// Regression: these have no "base + diacritic" decomposition, so before
		// the explicit mapping they were removed outright ("Łódź" -> "odz").
		expect(slugify("Łódź")).toBe("lodz");
		expect(slugify("Đakovo")).toBe("dakovo");
		expect(slugify("Ærø")).toBe("aero");
		expect(slugify("Þingvellir")).toBe("thingvellir");
		expect(slugify("Işık")).toBe("isik");
	});

	test("keeps underscores and digits, collapses everything else", () => {
		expect(slugify("report_2026 v3")).toBe("report_2026-v3");
		expect(slugify("a//b??c")).toBe("a-b-c");
	});
});
