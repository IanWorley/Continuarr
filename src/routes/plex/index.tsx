import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getApi } from "~/routes/api.$";

const PLEX_LOGIN_ERROR_MESSAGE = "Unable to start Plex login";

export const Route = createFileRoute("/plex/")({
	component: PlexTestPage,
});

export function PlexTestPage() {
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	async function loginToPlex() {
		setPending(true);
		setMessage(null);
		try {
			const { data, error } = await getApi().v1.auth.plex.login.start.post();
			if (error || !data) throw new Error(PLEX_LOGIN_ERROR_MESSAGE);
			window.location.assign(data.authorizationUrl);
		} catch {
			setMessage(PLEX_LOGIN_ERROR_MESSAGE);
			setPending(false);
		}
	}

	return (
		<div>
			<h1>Plex Test Page</h1>
			<button type="button" disabled={pending} onClick={loginToPlex}>
				Login to Plex
			</button>
			{message && <p role="alert">{message}</p>}
		</div>
	);
}
