/**
 * lib/images.ts
 *
 * Responsive-image URL helpers for the `<responsive-image>` component and any
 * template that builds a `<picture>`. They map a base image URL to the
 * width-stepped, format-swapped variants emitted by scripts/prepare_images.ts.
 *
 * Widths come from config/responsive_images.ts - the single source of truth
 * shared with the build pipeline, so markup and generated files never drift.
 *
 *   webp("/images/responsive/hero.png", 800) → "/images/responsive/800/hero.webp"
 *   srcset("/images/responsive/hero.png", "webp")
 *     → "/images/responsive/300/hero.webp 300w, …/800/hero.webp 800w, …"
 */

import { responsive_widths } from "$config/responsive_images";

/** Insert the width sub-folder immediately after `/responsive/`. */
function with_width(url: string, size?: number): string {
	if (!size) return url;
	const marker = "/responsive/";
	const marker_index = url.indexOf(marker);
	if (marker_index < 0) {
		throw new Error(`Responsive image URL must contain "${marker}": "${url}"`);
	}
	const insert_at = marker_index + marker.length;
	const before_width = url.slice(0, insert_at);
	const after_width = url.slice(insert_at);
	return `${before_width}${size}/${after_width}`;
}

export function avif(url: string, size?: number): string {
	let s = with_width(url, size);
	if (s.includes(".png")) return s.split(".png").join(".avif");
	s = s.split(".jpg").join(".avif");
	s = s.split(".jpeg").join(".avif");
	return s;
}

export function webp(url: string, size?: number): string {
	let s = with_width(url, size);
	if (s.includes(".png")) return s.split(".png").join(".webp");
	s = s.split(".jpg").join(".webp");
	s = s.split(".jpeg").join(".webp");
	return s;
}

export function jpeg(url: string, size?: number): string { return with_width(url, size); }

/**
 * Build a `srcset` descriptor string for one format from the configured
 * responsive widths. Keeps `<responsive-image>` and the generated files in sync.
 */
export function srcset(url: string, format: "webp" | "jpeg" | "avif"): string {
	const fn = format === "webp" ? webp : format === "avif" ? avif : jpeg;
	return responsive_widths.map((w) => `${fn(url, w)} ${w}w`).join(", ");
}
