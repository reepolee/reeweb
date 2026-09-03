/**
 * scripts/ssg/translation_merge.ts
 *
 * Pure helpers for navigating and combining the nested translation tree.
 * Used to layer route-specific strings on top of the global "routes" bundle
 * before rendering a template. The implementations live in
 * scripts/shared/translation_merge.ts (shared with the dev server); this
 * module re-exports them for the SSG phase.
 */

export { deep_merge, get_nested, merge_route_strings } from "../shared/translation_merge";
