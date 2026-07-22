/**
 * Project styling for generated Open Graph images.
 *
 * `scripts/generate_og_images.ts` reads this config after the static site has
 * rendered. Copy and adjust this file in another Reeweb project to use its
 * own identity without changing the generator.
 */
export const og_images = {
	logo_path: "images/logo-reepolee-text.svg",
	logo_color: "#ffffff",
	brand_color: "#b40000",
	background_color: "#0f172a",
	label: "REEWEB - STATIC SITE GENERATOR",
	show_code: true,
} as const;
