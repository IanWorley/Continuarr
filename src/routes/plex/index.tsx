import { createFileRoute } from "@tanstack/react-router";
import { getApi } from "~/routes/api.$";

const PLEX_LOGIN_ERROR_MESSAGE = "Unable to start Plex login";

export const Route = createFileRoute("/plex/")({
	component: PlexTestPage,
});

export function PlexTestPage() {
	async function loginToPlex() {
		const { data: authorizationUrl, error } =
			await getApi().v1.auth.plex.login.start.get();

		if (error) {
			throw error;
		}

		if (typeof authorizationUrl !== "string") {
			throw new Error(PLEX_LOGIN_ERROR_MESSAGE);
		}

		window.location.assign(authorizationUrl);
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
