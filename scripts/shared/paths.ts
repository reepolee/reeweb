/**
 * scripts/shared/paths.ts
 *
 * Project root and the source directories every script phase (ssg, dev, mcp,
 * preview, publisher) derives paths from. Moved out of scripts/mcp/paths so
 * shared code does not depend on the MCP tooling layer.
 */

import { join } from "node:path";

export const PROJECT_ROOT = join(import.meta.dir, "..", "..");
export const PUBLIC_DIR = join(PROJECT_ROOT, "src", "public");
export const COMPONENTS_DIR = join(PROJECT_ROOT, "src", "components");
