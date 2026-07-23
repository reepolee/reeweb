/**
 * Data loader for the static homepage.
 *
 * Convention: each .ree template can have a sibling {name}.ts file
 * that exports an async function `load_template_data()`.
 * Called during `bun run ssg` (static build) and on each request in `bun run dev`.
 */

type StarwarsApiPerson = { name: string; };

type StarwarsApiResponse = { results: StarwarsApiPerson[]; };

import team_from_json from "./team.json";
// import { handle_dynamic_assets } from "../lib/dynamic_assets";
// import { fetch_collection } from "../lib/reepolee_api";

export async function load_template_data(): Promise<Record<string, any>> {
	const starwars_res = await fetch("https://swapi.dev/api/people/?page=1");
	const starwars_json = (await starwars_res.json()) as StarwarsApiResponse;
	const starwars_characters = starwars_json.results;

	let team: any[] = [];
	team = team_from_json.data;

	// try {
	// 	const team_result = await fetch_collection("/team");
	// 	team = await handle_dynamic_assets(team_result.data);
	// } catch (err) {
	// 	console.warn("[reeweb] Could not fetch team from local reepolee server:", (err as Error).message);
	// }

	return { loaded_at: new Date().toISOString(), starwars_characters, team };
}
