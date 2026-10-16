import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlexConnect } from "./PlexConnect";

const ACCOUNT = { id: "account-a", userId: "owner", name: "Owner" };
const SERVER = {
	id: "server-a",
	accountId: ACCOUNT.id,
	externalId: "machine-a",
	name: "Living Room",
	url: "http://plex-a:32400",
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastError: null,
};
const refresh = async () => {};

describe("PlexConnect", () => {
	test("tells the owner to disconnect the saved server before switching", () => {
		const html = renderToStaticMarkup(
			<PlexConnect account={ACCOUNT} servers={[SERVER]} refresh={refresh} />,
		);

		expect(html).toContain(
			"Continuarr connects one Plex server. To switch servers, disconnect Living Room first.",
		);
	});

	test("asks to disconnect extra servers saved by an earlier version", () => {
		const html = renderToStaticMarkup(
			<PlexConnect
				account={ACCOUNT}
				servers={[SERVER, { ...SERVER, id: "server-b", name: "Basement" }]}
				refresh={refresh}
			/>,
		);

		expect(html).toContain(
			"Continuarr connects one Plex server, and 2 are saved. Disconnect the servers you no longer need.",
		);
	});
});
