import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
	logoutPlexRequest,
	PLEX_SESSION_QUERY_KEY,
	plexSessionQueryOptions,
	startPlexLoginRequest,
} from "~/frontend/plex/api";

export const Route = createFileRoute("/plex/")({
	component: PlexTestPage,
	validateSearch: z.object({ state: z.string().optional() }),
});

export function PlexTestPage() {
	const { state } = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const session = useQuery(plexSessionQueryOptions(state));
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState("");

	useEffect(() => {
		if (
			state &&
			(session.data?.status === "authenticated" || session.isError)
		) {
			if (session.data?.status === "authenticated") {
				queryClient.setQueryData(
					[...PLEX_SESSION_QUERY_KEY, undefined],
					session.data,
				);
			}
			// Remove the one-time login state from browser history.
			void navigate({ search: {}, replace: true });
			if (session.isError)
				setActionError("Plex sign-in failed. Please try again.");
		}
	}, [state, session.data, session.isError, navigate, queryClient]);

	async function loginToPlex() {
		setBusy(true);
		setActionError("");
		try {
			const result = await startPlexLoginRequest();
			window.location.assign(result.authorizationUrl);
		} catch {
			setActionError("Unable to start Plex sign-in. Please try again.");
			setBusy(false);
		}
	}

	async function logout() {
		setBusy(true);
		setActionError("");
		try {
			await logoutPlexRequest();
			queryClient.setQueriesData(
				{ queryKey: PLEX_SESSION_QUERY_KEY },
				{ status: "anonymous" },
			);
			await queryClient.invalidateQueries({ queryKey: PLEX_SESSION_QUERY_KEY });
		} catch {
			setActionError("Unable to sign out. Please try again.");
		} finally {
			setBusy(false);
		}
	}

	const user =
		session.data?.status === "authenticated" ? session.data.user : null;
	const pending = session.isPending || session.data?.status === "pending";
	return (
		<div>
			<h1>Plex</h1>
			<p role="status">
				{user
					? `Signed in as ${user.displayName}.`
					: pending
						? "Checking Plex sign-in…"
						: "Sign in with your Plex account."}
			</p>
			{actionError && <p role="alert">{actionError}</p>}
			{session.isError && !state && (
				<p role="alert">Unable to check your session.</p>
			)}
			<button
				type="button"
				disabled={busy || pending}
				onClick={user ? logout : loginToPlex}
			>
				{user ? "Sign out" : "Sign in with Plex"}
			</button>
		</div>
	);
}
