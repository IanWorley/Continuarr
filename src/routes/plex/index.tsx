import { createFileRoute } from "@tanstack/react-router";
import { getApi } from "~/routes/api.$";

export const Route = createFileRoute("/plex/")({
	component: PlexTestPage,
});

function PlexTestPage() {
	async function loginToPlex() {
		const { data, error } = await getApi().v1.auth.plex.login.start.get();

		if (error) {
			throw error;
		}

		window.open(data.authorizationUrl, "_blank");
	}

	return (
		<div>
			<h1>Plex Test Page</h1>
			<button type="button" onClick={loginToPlex}>
				Login to Plex
			</button>
		</div>
	);
}
