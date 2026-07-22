import { describe, expect, test } from "bun:test";

import { page_is_localized } from "$lib/static_site";

// ---------------------------------------------------------------------------
// page_is_localized
// ---------------------------------------------------------------------------

describe("page_is_localized", () => {
	test("defaults to true when the flag is absent", () => {
		expect(page_is_localized({})).toBe(true);
		expect(page_is_localized({ title: "Hello" })).toBe(true);
	});

	test("is true when localize is explicitly true", () => expect(page_is_localized({
		localize: true,
	})).toBe(true));

	test("is false only when localize is exactly false", () => expect(page_is_localized({
		localize: false,
	})).toBe(false));

	test("does not treat falsy-but-not-false values as opt-out", () => {
		// Guards against a `localize: 0` / `localize: ""` typo silently
		// de-localizing a page.
		expect(page_is_localized({ localize: 0 as unknown as boolean })).toBe(true);
		expect(page_is_localized({ localize: "" as unknown as boolean })).toBe(true);
		expect(page_is_localized({ localize: null as unknown as boolean })).toBe(true);
	});
});
