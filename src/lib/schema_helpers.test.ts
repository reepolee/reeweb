import { describe, expect, test } from "bun:test";
import { z } from "$vendor/zod.min.js";

import { optional_date, required_date } from "$root/src/lib/schema_helpers";

describe("required_date", () => {
	const schema = z.object({ published_at: required_date("published_at") });

	test("accepts a valid date string", () => {
		expect(schema.safeParse({ published_at: "2026-01-15" }).success).toBe(true);
	});

	test("rejects a missing field with a message naming the field and format", () => {
		const result = schema.safeParse({});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			'published_at is required and must be a valid date (e.g. "2026-01-15")'
		);
	});

	test("rejects an unparseable value with the same clear message, not Zod's default", () => {
		const result = schema.safeParse({ published_at: "not-a-date" });
		expect(result.success).toBe(false);
		const message = result.error?.issues[0]?.message ?? "";
		expect(message).toBe(
			'published_at is required and must be a valid date (e.g. "2026-01-15")'
		);
		// Regression: Zod's own z.coerce.date() message for this case reads
		// "expected date, received Date" - confusing since both sides say
		// "date" (the coercion runs before validation, turning a bad string
		// into an Invalid Date object). Guard against that message leaking back.
		expect(message).not.toContain("received Date");
	});
});

describe("optional_date", () => {
	const schema = z.object({ last_updated_at: optional_date("last_updated_at") });

	test("allows the field to be omitted", () => {
		expect(schema.safeParse({}).success).toBe(true);
	});

	test("accepts a valid date string when present", () => {
		expect(schema.safeParse({ last_updated_at: "2026-01-15" }).success).toBe(true);
	});

	test("rejects an unparseable value with a clear message", () => {
		const result = schema.safeParse({ last_updated_at: "nope" });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			'last_updated_at must be a valid date (e.g. "2026-01-15")'
		);
	});
});
