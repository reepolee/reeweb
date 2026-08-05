/**
 * scripts/dev/responses.ts
 *
 * Response builders for the dev server. HTML responses are sent uncached so
 * live reload always reflects the latest source.
 */

import { mime_type } from "./mime";

export function respond_html(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Disposition": "inline",
			"Cache-Control": "no-cache, no-store, must-revalidate",
		},
	});
}

export function respond_file(full_path: string): Response {
	return new Response(Bun.file(full_path), {
		headers: {
			"Content-Type": mime_type(full_path),
			"Content-Disposition": "inline",
			"Cache-Control": "no-cache",
		},
	});
}

export function respond_not_found(): Response {
	return respond_html("<h1>404 Not Found</h1>", 404);
}

export function respond_error(msg: string): Response {
	return respond_html(`<h1>500 Error</h1><pre>${msg}</pre>`, 500);
}
