import { describe, expect, test } from "bun:test";

import {
	build_window,
	chunk_count,
	paginate,
	read_per_page_override,
	type PageLink,
	type WindowItem,
} from "$lib/pagination";

const opts = {
	show_when_single_page: false,
	always_show_prev_next: true,
	labels: {
		previous: "Previous",
		next: "Next",
		aria: "Pagination",
		showing: "Showing",
		to: "to",
		of: "of",
		results: "results",
		total_label: "total",
	},
};

const url_for = (n: number) => (n === 1 ? "/blog/" : `/blog/page/${n}/`);

// ── chunk_count ────────────────────────────────────────────────────────────

describe("chunk_count", () => {
	test("rounds up partial pages", () => {
		expect(chunk_count(0, 10)).toBe(1);
		expect(chunk_count(1, 10)).toBe(1);
		expect(chunk_count(10, 10)).toBe(1);
		expect(chunk_count(11, 10)).toBe(2);
		expect(chunk_count(25, 10)).toBe(3);
	});

	test("never returns less than 1", () => {
		expect(chunk_count(0, 5)).toBe(1);
		expect(chunk_count(-5, 5)).toBe(1);
		expect(chunk_count(5, 0)).toBe(1);
	});
});

// ── paginate ───────────────────────────────────────────────────────────────

describe("paginate", () => {
	test("single page when everything fits", () => {
		const p = paginate(2, 1, 10, opts, url_for);
		expect(p.last_page).toBe(1);
		expect(p.has_pages).toBe(false);
		expect(p.on_first_page).toBe(true);
		expect(p.on_last_page).toBe(true);
		expect(p.prev_url).toBeNull();
		expect(p.next_url).toBeNull();
		expect(p.from).toBe(1);
		expect(p.to).toBe(2);
		expect(p.pages.map((x) => x.number)).toEqual([1]);
	});

	test("from/to and neighbours on a middle page", () => {
		const p = paginate(25, 2, 10, opts, url_for);
		expect(p.last_page).toBe(3);
		expect(p.has_pages).toBe(true);
		expect(p.from).toBe(11);
		expect(p.to).toBe(20);
		expect(p.on_first_page).toBe(false);
		expect(p.on_last_page).toBe(false);
		expect(p.prev_url).toBe("/blog/");
		expect(p.next_url).toBe("/blog/page/3/");
	});

	test("last page to is clamped to total", () => {
		const p = paginate(25, 3, 10, opts, url_for);
		expect(p.from).toBe(21);
		expect(p.to).toBe(25);
		expect(p.on_last_page).toBe(true);
		expect(p.next_url).toBeNull();
	});

	test("page number is clamped into range", () => {
		expect(paginate(25, 99, 10, opts, url_for).current_page).toBe(3);
		expect(paginate(25, -3, 10, opts, url_for).current_page).toBe(1);
	});

	test("empty set yields from/to 0 and one page", () => {
		const p = paginate(0, 1, 10, opts, url_for);
		expect(p.last_page).toBe(1);
		expect(p.from).toBe(0);
		expect(p.to).toBe(0);
		expect(p.has_pages).toBe(false);
	});

	test("active flag marks the current page only", () => {
		const p = paginate(25, 2, 10, opts, url_for);
		expect(p.pages.map((x) => x.active)).toEqual([false, true, false]);
	});
});

// ── build_window ─────────────────────────────────────────────────────────────

function make_pages(last: number, current: number): PageLink[] {
	const out: PageLink[] = [];
	for (let i = 1; i <= last; i++) out.push({ number: i, url: url_for(i), active: i === current });
	return out;
}

/** Render a window to a compact form: page numbers and "..." for ellipses. */
function shape(items: WindowItem[]): (number | "...")[] {
	return items.map((it) => ("ellipsis" in it ? "..." : it.number));
}

describe("build_window", () => {
	test("null on_each_side shows every page", () => {
		const pages = make_pages(12, 6);
		expect(shape(build_window(pages, 6, 12, null))).toEqual([
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9,
			10,
			11,
			12,
		]);
	});

	test("windows around the middle with ellipses both sides", () => {
		const pages = make_pages(20, 10);
		expect(shape(build_window(pages, 10, 20, 2))).toEqual([
			1,
			"...",
			8,
			9,
			10,
			11,
			12,
			"...",
			20,
		]);
	});

	test("near the start: no leading ellipsis", () => {
		const pages = make_pages(20, 2);
		expect(shape(build_window(pages, 2, 20, 2))).toEqual([1, 2, 3, 4, "...", 20]);
	});

	test("near the end: no trailing ellipsis", () => {
		const pages = make_pages(20, 19);
		expect(shape(build_window(pages, 19, 20, 2))).toEqual([1, "...", 17, 18, 19, 20]);
	});

	test("single hidden page is shown instead of an ellipsis", () => {
		// last=7, current=4, n=1 → edges+window leave only single gaps → all pages
		const pages = make_pages(7, 4);
		expect(shape(build_window(pages, 4, 7, 1))).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	test("on_each_side 0 still keeps first/last and current", () => {
		const pages = make_pages(10, 5);
		expect(shape(build_window(pages, 5, 10, 0))).toEqual([1, "...", 5, "...", 10]);
	});
});

// ── read_per_page_override ───────────────────────────────────────────────────

describe("read_per_page_override", () => {
	test("reads per-page off full-pagination", () => expect(read_per_page_override(
		`<full-pagination data="{= props.pagination }" per-page="5"></full-pagination>`
	)).toBe(5));

	test("reads per-page off simple-pagination, any attribute order", () => expect(read_per_page_override(
		`<simple-pagination per-page="8" data="{= props.pagination }">`
	)).toBe(8));

	test("accepts single quotes", () => expect(read_per_page_override(
		`<full-pagination per-page='3'>`
	)).toBe(3));

	test("null when absent or non-positive or non-literal", () => {
		expect(read_per_page_override(`<full-pagination data="{= props.pagination }">`)).toBeNull();
		expect(read_per_page_override(`<full-pagination per-page="0">`)).toBeNull();
		expect(read_per_page_override(`<full-pagination per-page="{= n }">`)).toBeNull();
		expect(read_per_page_override(`<div per-page="5">`)).toBeNull();
	});
});
