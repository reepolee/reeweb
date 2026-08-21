/**
 * src/lib/schema_helpers.ts
 *
 * Small Zod helpers for content-collection `_schema.ts` files (see
 * scripts/ssg/collections.ts). `z.coerce.date()` runs `new Date(value)`
 * before validating, so a missing or unparseable field becomes an
 * `Invalid Date` object rather than staying `undefined` - Zod's default
 * message for that case reads as "expected date, received Date", which is
 * confusing because both sides say "date". These wrap it with a message that
 * actually says what to do.
 */

import { z } from "$vendor/zod.min.js";

/** Required date field with a clear error for both missing and unparseable values. */
export function required_date(label: string) {
	return z.coerce.date({
		error: () => `${label} is required and must be a valid date (e.g. "2026-01-15")`,
	});
}

/** Optional date field with a clear error when present but unparseable. */
export function optional_date(label: string) {
	return z.coerce.date({
		error: () => `${label} must be a valid date (e.g. "2026-01-15")`,
	}).optional();
}
