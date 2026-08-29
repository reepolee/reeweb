export default {
	async fetch(req: Request, env: { ASSETS: Fetcher; }): Promise<Response> {
		const res = await env.ASSETS.fetch(req);

		if (!res.headers.get("content-type")?.includes("text/html")) return res;

		const colo = (req as any).cf?.colo as string | undefined;

		if (!colo) return res;

		return new HTMLRewriter().on("[data-cf-edge]", {
			element(el) {
				el.setInnerContent(colo);
				el.removeAttribute("data-cf-template");
				el.removeAttribute("data-cf-edge");
			},
		}).transform(res);
	},
};
