/**
 * lib/tw_merge.ts
 *
 * Thin wrapper over `tailwind-merge` so templates can merge Tailwind utility
 * classes with correct conflict resolution - later classes win within a group
 * (width, padding, object-fit, colours, variants like `md:`/`hover:`, …).
 *
 * Exposed to templates as the `tw_merge` helper. Lets a component define
 * default utilities that callers can reliably override:
 *
 *   tw_merge("w-full object-cover", props.attributes.image_class)
 *
 * Build-time only - the merged string is baked into static HTML, so
 * tailwind-merge never ships to the browser. Keep its major version aligned
 * with the Tailwind CSS major in use (tailwind-merge v3 ↔ Tailwind v4).
 */

import { twMerge, type ClassNameValue } from "tailwind-merge";
export function tw_merge(...classes: ClassNameValue[]): string { return twMerge(classes); }
