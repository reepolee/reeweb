/**
 * scripts/ssg/routing.ts
 *
 * Build-side adapter over the shared route-resolution core
 * (scripts/shared/routing.ts). Re-exports everything; the shared module
 * holds the pure algorithms so the dev server stays in lock-step.
 */

export { create_route_resolver, normalize_internal_page_links, output_target, with_trailing_slash } from "../shared/routing";

export type { RouteResolver, OutputTarget } from "../shared/routing";
