// Client for the reepolee read API (Accept: application/json on regular CRUD routes).
// Called from load_template_data() during build - reepolee must be running in agent mode.
// Start reepolee: bun run agent (dev-only; binds to 127.0.0.1:AGENT_SERVER_PORT, e.g. 2500)
// Set REEPOLEE_API_URL=http://localhost:<AGENT_SERVER_PORT> in .env before building.
// Fails loudly when REEPOLEE_API_URL is not set (no fallback, no cache).

const JSON_HEADERS = { "Accept": "application/json" };

function get_base_url(): string {
	const base_url = Bun.env.REEPOLEE_API_URL;
	if (!base_url) throw new Error(
		"REEPOLEE_API_URL is not set. Run reepolee with `bun dev --agent` and set REEPOLEE_API_URL to its AGENT_SERVER_PORT.",
	);
	return base_url;
}

export type CollectionResult = { data: any[]; total: number; limit: number; offset: number; };

// route_path: the table's URL prefix e.g. "/admin/authors", "/admin/frameworks"
export async function fetch_collection(route_path: string, opts: { limit?: number; offset?: number; order_by?: string; query?: string; } = {}): Promise<CollectionResult> {
	const params = new URLSearchParams();
	if (opts.query) params.set("query", opts.query);
	if (opts.limit != null) params.set("limit", String(opts.limit));
	if (opts.offset != null) params.set("offset", String(opts.offset));
	if (opts.order_by != null) params.set("order_by", opts.order_by);

	const query_string = params.toString();
	const url = `${get_base_url()}${route_path}${query_string ? `?${query_string}` : ""}`;
	const res = await fetch(url, { headers: JSON_HEADERS });
	if (!res.ok) throw new Error(`reepolee API error ${res.status} for "${route_path}"`);
	return res.json() as Promise<CollectionResult>;
}

// id: the record's numeric or string id
export async function fetch_record(route_path: string, id: number | string): Promise<any | null> {
	const url = `${get_base_url()}${route_path}/${id}/edit`;
	const res = await fetch(url, { headers: JSON_HEADERS });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`reepolee API error ${res.status} for "${route_path}/${id}/edit"`);
	return res.json();
}
