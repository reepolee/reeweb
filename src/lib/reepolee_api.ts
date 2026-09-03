// Client for the reepolee read API (Accept: application/json on regular CRUD routes).
// Called from load_template_data() during build - reepolee must be running in agent mode.
// Start reepolee: bun run agent (dev-only; binds to 127.0.0.1:AGENT_SERVER_PORT, e.g. 2500)
// Set REEPOLEE_API_URL=http://localhost:<AGENT_SERVER_PORT> in .env before building.
// If /images and /files routes are on a separate server, also set REEMAN_API_URL.
// Fails loudly when REEPOLEE_API_URL is not set (no fallback, no cache).
//
// Locale: reepolee stores content in locale-suffixed tables (`team`, `team_sl_si`)
// and picks the physical table from the request locale, so every call must say
// which locale it wants. The locale is a lowercase BCP 47 code ("en-us", "sl-si")
// and travels as the standard `Accept-Language` header.
//
// Reepolee requires it on JSON requests and answers 400 when it is missing or
// names a locale it does not serve - it never falls back to a default. The
// shape check below is the same rule applied locally, so a bad locale fails
// here with a clearer message instead of costing a round trip.

const JSON_HEADERS = { "Accept": "application/json" };

const LOCALE_SHAPE = /^[a-z]{2,3}(-([a-z]{2,3}|[a-z]{4}|\d{3}))*$/;

function get_base_url(route_path: string = ""): string {
	const is_dynamic_assets = route_path.startsWith("/images") || route_path.startsWith("/files");
	const env_var = is_dynamic_assets ? "REEMAN_API_URL" : "REEPOLEE_API_URL";
	const fallback_env_var = "REEPOLEE_API_URL";

	let base_url = Bun.env[env_var];
	if (!base_url && is_dynamic_assets) {
		base_url = Bun.env[fallback_env_var];
	}

	if (!base_url) throw new Error(
		`${env_var} is not set. Run reepolee with \`bun dev --agent\` and set ${env_var} to its server port.`,
	);
	return base_url;
}

function build_headers(locale: string): Record<string, string> {
	if (!locale) throw new Error(
		"reepolee API: locale is required. Pass the BCP 47 locale for the page being rendered (e.g. \"sl-si\").",
	);
	if (!LOCALE_SHAPE.test(locale)) throw new Error(
		`reepolee API: "${locale}" is not a canonical lowercase BCP 47 locale (expected e.g. "en-us").`,
	);
	return { ...JSON_HEADERS, "Accept-Language": locale };
}

export type CollectionResult = { data: any[]; total: number; limit: number; offset: number; };

// Reepolee answers a rejected locale with { error, message, supported_locales }.
// Surfacing that turns a bare "400" into a message naming the locales it serves.
async function describe_error(res: Response, target: string, locale: string): Promise<string> {
	const base = `reepolee API error ${res.status} for "${target}" (locale ${locale})`;
	try {
		const body = await res.json() as { message?: string; supported_locales?: string[]; };
		if (!body?.message) return base;
		const supported = body.supported_locales?.length ? ` Supported: ${body.supported_locales.join(", ")}.` : "";
		return `${base}: ${body.message}${supported}`;
	} catch {
		return base;
	}
}

// route_path: the table's URL prefix e.g. "/admin/authors", "/admin/frameworks"
// locale: BCP 47 code selecting the locale-suffixed table to read
export async function fetch_collection(route_path: string, locale: string, opts: { limit?: number; offset?: number; order_by?: string; query?: string; } = {}): Promise<CollectionResult> {
	const headers = build_headers(locale);
	const params = new URLSearchParams();
	if (opts.query) params.set("query", opts.query);
	if (opts.limit != null) params.set("limit", String(opts.limit));
	if (opts.offset != null) params.set("offset", String(opts.offset));
	if (opts.order_by != null) params.set("order_by", opts.order_by);

	const query_string = params.toString();
	const url = `${get_base_url(route_path)}${route_path}${query_string ? `?${query_string}` : ""}`;
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(await describe_error(res, route_path, locale));
	return res.json() as Promise<CollectionResult>;
}

// id: the record's numeric or string id
// locale: BCP 47 code selecting the locale-suffixed table to read
export async function fetch_record(route_path: string, id: number | string, locale: string): Promise<any | null> {
	const headers = build_headers(locale);
	const url = `${get_base_url(route_path)}${route_path}/${id}/edit`;
	const res = await fetch(url, { headers });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(await describe_error(res, `${route_path}/${id}/edit`, locale));
	return res.json();
}
