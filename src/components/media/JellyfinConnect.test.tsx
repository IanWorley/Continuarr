import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JellyfinConnect } from "./JellyfinConnect";

const SERVER = {
	id: "server-a",
	externalId: "jellyfin-a",
	name: "Living Room",
	url: "http://jellyfin-a:8096",
	revision: 0,
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastError: null,
};
const refresh = async () => {};

describe("JellyfinConnect", () => {
	test("opens the saved server in replace-key mode", () => {
		const html = renderToStaticMarkup(
			<JellyfinConnect servers={[SERVER]} refresh={refresh} />,
		);

		expect(html).toContain('value="http://jellyfin-a:8096"');
		expect(html).toContain("Replace key and import users");
		expect(html).toContain(
			"Continuarr connects one Jellyfin server. To switch servers, disconnect Living Room first.",
		);
	});

	test("asks to disconnect extra servers instead of showing the form", () => {
		const html = renderToStaticMarkup(
			<JellyfinConnect
				servers={[SERVER, { ...SERVER, id: "server-b", name: "Basement" }]}
				refresh={refresh}
			/>,
		);

		expect(html).toContain(
			"Continuarr connects one Jellyfin server, and 2 are saved. Disconnect the servers you no longer need.",
		);
		expect(html).not.toContain("<form");
	});
});
