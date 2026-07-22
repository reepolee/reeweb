/**
 * Client-side search for the Cmd/Ctrl+K modal (src/components/site-search.ree).
 *
 * Fetches the static index emitted by scripts/generate_search_index.ts. A
 * single-source site (the default) loads /search-index.json and renders one
 * flat list; a site split into several sources loads the current section's
 * index first, the rest in the background, and groups results under each
 * source's brand.
 *
 * The source list ({ prefix, brand }) comes from the #search-sites JSON block;
 * the modal carries data-search-local="<current prefix>". Open/close and
 * focus-trap behavior live in the component's own script - this file only owns
 * fetching, scoring, rendering, and result-list keyboard navigation. No
 * dependencies; brute-force scoring over a few thousand records is instant.
 */
(function () {
	const modal = document.getElementById("search-modal");
	const input = document.getElementById("search-input");
	const results_el = document.getElementById("search-results");
	const status_el = document.getElementById("search-status");
	const sites_el = document.getElementById("search-sites");
	if (!modal || !input || !results_el || !status_el) return;

	const local_prefix = modal.dataset.searchLocal || "";

	// Ordered source list: the local one first, then config order.
	let sites = [];
	try {
		const parsed = JSON.parse(sites_el ? sites_el.textContent : "[]");
		sites = parsed.filter((s) => s.prefix === local_prefix).concat(parsed.filter((s) => s.prefix !== local_prefix));
	} catch (err) {
		console.error("site-search: invalid #search-sites JSON", err);
	}
	if (sites.length === 0) {
		sites = [{ prefix: local_prefix, brand: "" }];
	}

	const LOCAL_MAX_RESULTS = 6;
	const OTHER_MAX_RESULTS = 3;
	const MAX_PER_PAGE = 3;

	// prefix → array of prepared records; missing key = not loaded (yet).
	const loaded = new Map();
	let load_started = false;
	let selected = -1;
	let rendered_links = [];

	// -- Index loading (local first, the rest in the background) --

	async function fetch_index(site) {
		const res = await fetch(site.prefix + "/search-index.json");
		if (!res.ok) throw new Error(String(res.status));
		const data = await res.json();
		loaded.set(site.prefix, (data.records || []).map((r) => ({
			...r,
			title_lc: r.title.toLowerCase(),
			heading_lc: r.heading.toLowerCase(),
			text_lc: r.text.toLowerCase(),
		})));
	}

	function load_indexes() {
		if (load_started) return;
		load_started = true;

		const local = sites[0];
		if (!local) return;

		fetch_index(local).then(run_search).catch((err) => {
			status_el.textContent = "Search index not available. Run “bun ssg:search” to generate it.";
			console.error("site-search: failed to load index", err);
		}).finally(() => {
			// Remaining sources load after the local one so its results render
			// first; each arrival re-runs the current query. A failure only costs
			// that source's section.
			for (const site of sites.slice(1)) {
				fetch_index(site).then(run_search).catch((err) => console.warn(
					"site-search: skipping " + site.prefix,
					err
				));
			}
		});
	}

	// Focus is the usual trigger, but it is not guaranteed: opening the dialog
	// programmatically, or a browser that does not move focus on showModal(),
	// would otherwise leave the index unloaded and the dialog permanently
	// empty. Typing loads it too, and load_indexes() is idempotent.
	input.addEventListener("focus", load_indexes);
	input.addEventListener("input", load_indexes);

	// -- Scoring --

	// True when `needle` appears in `haystack` as a subsequence with all
	// matches after a word boundary or contiguous - catches abbreviations
	// ("gs" → "getting started") without matching random letter soup.
	function fuzzy_match(needle, haystack) {
		let h = 0;
		let last = -2;
		for (let n = 0; n < needle.length; n++) {
			const ch = needle[n];
			let found = -1;
			while (h < haystack.length) {
				if (haystack[h] === ch && (h === last + 1 || h === 0 || haystack[h - 1] === " " || haystack[h - 1] === "-")) {
					found = h;
					break;
				}
				h++;
			}
			if (found === -1) return false;
			last = found;
			h = found + 1;
		}
		return true;
	}

	// Substring score within one field: word-boundary hits beat mid-word hits.
	function field_score(term, field_lc, boundary_pts, anywhere_pts) {
		const idx = field_lc.indexOf(term);
		if (idx === -1) return 0;
		const at_boundary = idx === 0 || field_lc[idx - 1] === " " || field_lc[idx - 1] === "-";
		return at_boundary ? boundary_pts : anywhere_pts;
	}

	function score_record(terms, rec) {
		let total = 0;
		for (const term of terms) {
			let s = Math.max(
				field_score(term, rec.heading_lc, 8, 5),
				field_score(term, rec.title_lc, 6, 4),
				field_score(term, rec.text_lc, 3, 1)
			);
			if (s === 0 && term.length >= 2 && (fuzzy_match(term, rec.heading_lc) || fuzzy_match(term, rec.title_lc))) {
				s = 2;
			}
			if (s === 0) return 0; // every term must match somewhere
			total += s;
		}
		// Prefer sections over bare page leads when scores tie.
		return total + (rec.anchor ? 0.5 : 0);
	}

	// One result group per source with matches: { brand, results }, in load
	// order (local first).
	function search(query) {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (terms.length === 0) return [];

		const groups = [];
		for (const site of sites) {
			const records = loaded.get(site.prefix);
			if (!records) continue;

			const scored = [];
			for (const rec of records) {
				const s = score_record(terms, rec);
				if (s > 0) scored.push({ rec, s });
			}
			scored.sort((a, b) => b.s - a.s);

			const max = site.prefix === local_prefix ? LOCAL_MAX_RESULTS : OTHER_MAX_RESULTS;
			const out = [];
			const per_page = new Map();
			for (const { rec } of scored) {
				const count = per_page.get(rec.url) || 0;
				if (count >= MAX_PER_PAGE) continue;
				per_page.set(rec.url, count + 1);
				out.push(rec);
				if (out.length >= max) break;
			}

			if (out.length > 0) groups.push({ brand: site.brand, results: out });
		}
		return groups;
	}

	// -- Rendering --

	function escape_html(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	// Find every term's match ranges in the raw text, merge overlaps, then emit
	// escaped HTML with <mark> around the merged ranges (marking after escaping
	// per-term would let later terms match inside earlier <mark> markup).
	function highlight(text, terms) {
		const lc = text.toLowerCase();
		const ranges = [];
		for (const term of terms) {
			if (term.length < 2) continue;
			let from = 0;
			let idx;
			while ((idx = lc.indexOf(term, from)) !== -1) {
				ranges.push([idx, idx + term.length]);
				from = idx + term.length;
			}
		}
		if (ranges.length === 0) return escape_html(text);

		ranges.sort((a, b) => a[0] - b[0]);
		const merged = [ranges[0]];
		for (const r of ranges.slice(1)) {
			const last = merged[merged.length - 1];
			if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
			else merged.push(r);
		}

		let html = "";
		let pos = 0;
		for (const [start, end] of merged) {
			html += escape_html(text.slice(pos, start));
			html += "<mark class=\"bg-brand/15 text-inherit rounded-sm\">" + escape_html(text.slice(start, end)) + "</mark>";
			pos = end;
		}
		return html + escape_html(text.slice(pos));
	}

	function snippet_for(rec, terms) {
		const text = rec.text;
		if (!text) return "";
		let idx = -1;
		for (const term of terms) {
			idx = rec.text_lc.indexOf(term);
			if (idx !== -1) break;
		}
		if (idx === -1) idx = 0;
		const start = Math.max(0, idx - 40);
		const end = Math.min(text.length, idx + 120);
		return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
	}

	function render_results(groups, terms, query) {
		results_el.innerHTML = "";
		rendered_links = [];
		selected = -1;
		input.removeAttribute("aria-activedescendant");

		if (groups.length === 0) {
			status_el.textContent = query ? "No results for “" + query + "”" : "Type to search…";
			status_el.hidden = false;
			return;
		}
		status_el.hidden = true;

		for (const group of groups) {
			if (group.brand) {
				const header = document.createElement("div");
				header.className = "px-4 pt-3 pb-1 text-base uppercase tracking-[0.15em] font-bold text-neutral-500";
				header.textContent = group.brand;
				results_el.appendChild(header);
			}

			for (const rec of group.results) {
				const a = document.createElement("a");
				a.id = "search-result-" + rendered_links.length;
				a.href = rec.url + "/" + (rec.anchor ? "#" + rec.anchor : "");
				a.className = "block px-4 py-3 border-b border-neutral-200 last:border-b-0 hover:bg-neutral-100 transition-colors";
				a.setAttribute("role", "option");

				const crumb = rec.heading && rec.heading !== rec.title ? escape_html(rec.title) + " › " : "";
				const snippet = snippet_for(rec, terms);
				a.innerHTML = "<div class=\"text-base font-semibold\">" + crumb + highlight(rec.heading || rec.title, terms) + "</div>" + (snippet ? "<div class=\"text-sm text-neutral-500 mt-0.5 line-clamp-2\">" + highlight(snippet, terms) + "</div>" : "");

				a.addEventListener("mousemove", () => set_selected(rendered_links.indexOf(a)));
				results_el.appendChild(a);
				rendered_links.push(a);
			}
		}
		set_selected(0);
	}

	function set_selected(i) {
		if (i === selected) return;
		selected = i;
		rendered_links.forEach((a, idx) => {
			const is_selected = idx === selected;
			a.classList.toggle("bg-neutral-100", is_selected);
			a.setAttribute("aria-selected", String(is_selected));
		});
		if (selected >= 0) {
			input.setAttribute("aria-activedescendant", rendered_links[selected].id);
			rendered_links[selected].scrollIntoView({ block: "nearest" });
		} else {
			input.removeAttribute("aria-activedescendant");
		}
	}

	// -- Wiring --

	function run_search() {
		// Nothing loaded yet: keep the current status (hint or failure message).
		if (loaded.size === 0) return;
		const query = input.value.trim();
		render_results(query ? search(query) : [], query.toLowerCase().split(/\s+/).filter(Boolean), query);
	}

	input.addEventListener("input", run_search);

	input.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (rendered_links.length) set_selected((selected + 1) % rendered_links.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (rendered_links.length) set_selected((selected - 1 + rendered_links.length) % rendered_links.length);
		} else if (e.key === "Enter") {
			if (selected >= 0 && rendered_links[selected]) {
				e.preventDefault();
				window.location.href = rendered_links[selected].href;
			}
		}
	});
})();
