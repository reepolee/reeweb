import { describe, expect, test } from "bun:test";

import { jpeg_output_name, quality_for } from "./prepare_images";

describe("jpeg_output_name", () => {
	test("uses a distinct JPG fallback for a WebP source", () => {
		expect(jpeg_output_name("photo", ".webp")).toBe("photo.jpg");
	});

	test("preserves the legacy fallback extension for existing source formats", () => {
		expect(jpeg_output_name("photo", ".png")).toBe("photo.png");
		expect(jpeg_output_name("photo", ".jpg")).toBe("photo.jpg");
	});
});

describe("quality_for", () => {
	test("uses lossless WebP and the screenshot JPEG quality for PNG sources", () => {
		const quality = quality_for(".png", { webp: 80, jpeg: 80 });

		expect(quality).toEqual({ webp: 80, jpeg: 85, lossless_webp: true });
	});

	test("keeps configured lossy quality for photographic and WebP sources", () => {
		const base_quality = { webp: 80, jpeg: 80 };

		expect(quality_for(".jpg", base_quality)).toBe(base_quality);
		expect(quality_for(".webp", base_quality)).toBe(base_quality);
	});

	test("respects explicit quality overrides for PNG sources", () => {
		const quality = quality_for(".png", {
			webp: 72,
			jpeg: 74,
			webp_overridden: true,
			jpeg_overridden: true,
		});

		expect(quality).toEqual({ webp: 72, jpeg: 74, lossless_webp: false });
	});
});
