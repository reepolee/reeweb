/**
 * Data loader for the static homepage.
 *
 * Convention: each .ree template can have a sibling {name}.ts file
 * that exports an async function `load_template_data()`.
 * Called during `bun run ssg` (static build) and on each request in `bun run dev`.
 */

type StarwarsApiPerson = {
	name: string;
	height: string;
	mass: string;
	hair_color: string;
	skin_color: string;
	eye_color: string;
	birth_year: string;
	gender: string;
	homeworld: string;
	films: string[];
	species: string[];
	vehicles: string[];
	starships: string[];
	created: string;
	edited: string;
	url: string;
};

type StarwarsApiResponse = StarwarsApiPerson[];

import frameworks_from_json from "./frameworks.json";
// import { handle_dynamic_assets } from "../lib/dynamic_assets";
// import { fetch_collection } from "../lib/reepolee_api";

// `locale` is the BCP 47 code of the page being rendered ("en-us", "sl-si").
// The loader runs once per language, so pass it to any reepolee fetch to get
// that locale's content instead of the default locale's.
export async function load_template_data({ locale }: { locale: string; }): Promise<Record<string, any>> {
	const starwars_res = await fetch("https://swapi.info/api/people");
	const starwars_json = (await starwars_res.json()) as StarwarsApiResponse;
	const starwars_characters = starwars_json.slice(0, 10);

	let frameworks: any[] = [];
	frameworks = frameworks_from_json.data;

	// try {
	// 	const frameworks_result = await fetch_collection("/frameworks?limit=10&offset=10", locale);
	// 	frameworks = await handle_dynamic_assets(frameworks_result.data);
	// } catch (err) {
	// 	console.warn("[reeweb] Could not fetch frameworks from local reepolee server:", (err as Error).message);
	// }

	return { loaded_at: new Date().toISOString(), starwars_characters, frameworks };
}
