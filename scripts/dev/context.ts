/**
 * scripts/dev/context.ts
 *
 * The dependency bundle the dev render functions receive (engine + mutable
 * site state + sidebar map). Assembled once at startup by dev.ts; the sidebar
 * map and state contents update in place.
 */

import type TemplateEngine from "$lib/template_engine";

import type { SidebarMap } from "./sidebar";
import type { SiteState } from "./site_state";

export type DevContext = { engine: TemplateEngine; state: SiteState; sidebar_map: SidebarMap; };
