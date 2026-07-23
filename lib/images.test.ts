import { describe, expect, test } from "bun:test";

import { jpeg, webp } from "./images";

describe("responsive image width paths", () => {
	test("inserts the width directly after the responsive directory", () => {
		const url = "/images/responsive/dynamic/clubs/photo.jpg";

		expect(jpeg(url, 800)).toBe("/images/responsive/800/dynamic/clubs/photo.jpg");
		expect(webp(url, 800)).toBe("/images/responsive/800/dynamic/clubs/photo.webp");
	});

	test("preserves a content fingerprint query", () => {
		const url = "/images/responsive/dynamic/clubs/photo.jpg?v=abc123";

		expect(webp(url, 300)).toBe(
			"/images/responsive/300/dynamic/clubs/photo.webp?v=abc123",
		);
	});

	test("fails clearly for a URL outside the responsive image pipeline", () => {
		expect(() => webp("/images/photo.jpg", 300)).toThrow(
			'Responsive image URL must contain "/responsive/"',
		);
	});
});
