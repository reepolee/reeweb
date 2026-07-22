/**
 * scripts/dev/mime.ts
 *
 * Static MIME-type lookup for files the dev server serves verbatim.
 */

import { extname } from "path";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
};

export function mime_type(path: string): string {
	return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}
