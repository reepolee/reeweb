/**
 * ── Project hooks ────────────────────────────────────────────
 *
 * The ssg/dev scripts (`scripts/`) and the upstream library (`lib/`) are kept
 * byte-identical across all Reeweb projects and should NOT be modified. When a
 * project needs the scripts to behave differently, implement one of the hooks
 * defined by the upstream contract (`$lib/hooks`) here instead.
 *
 * Every hook is optional. The empty object below is the base/default: it makes
 * the scripts behave exactly as if there were no hooks at all. Add only what
 * this project needs - see PLAN_script_extension_points.md and the doc comments
 * on `ProjectHooks` in lib/hooks.ts for what each hook does.
 *
 * Example:
 *   import pkg from "../../package.json";
 *   export const project_hooks: ProjectHooks = {
 *     page_data_extras: () => ({ app_version: pkg.version }),
 *     helper_functions: { shout: (s: string) => String(s).toUpperCase() },
 *   };
 */

import type { ProjectHooks } from "$lib/hooks";
import { project_helper_functions } from "$root/src/lib/project_helpers";

export const project_hooks: ProjectHooks = {
	helper_functions: project_helper_functions as Record<string, (...args: any[]) => unknown>,
};
