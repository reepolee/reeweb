/**
 * config/responsive_images.ts
 *
 * Responsive-image configuration - the single source of truth for the width
 * breakpoints (and encoder quality) used by the build pipeline.
 *
 * Two consumers read this file, so they always stay in sync:
 *   - scripts/prepare_images.ts - generates a variant at each width.
 *   - lib/images.ts             - the `srcset()` helper builds the
 *     <responsive-image> `<source srcset>` from the same list.
 *
 * Change the widths here and both the generated files and the markup that
 * references them update together. CLI flags on prepare_images.ts
 * (--widths / --quality*) still override these at build time when needed.
 */

// Width breakpoints in px, generated for every image and offered as
// `<source srcset>` candidates. The browser downloads the smallest one that
// satisfies the layout. Widths are never upscaled: a breakpoint larger than a
// given original is clamped to that original's width.
export const responsive_widths = [300, 500, 800, 1440] as const;

// Encoder quality (1-100) per output format. WebP is what browsers actually
// download; JPEG is the universal fallback. Lower these to trade quality for
// smaller files.
export const responsive_quality = { webp: 80, jpeg: 80 } as const;
