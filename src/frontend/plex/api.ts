import { queryOptions } from "@tanstack/react-query";
import { getApi } from "~/routes/api.$";

const PLEX_LOGIN_ERROR_MESSAGE = "Unable to complete Plex login";
const PLEX_LOGIN_POLL_INTERVAL_MS = 1_000;
export const PLEX_SESSION_QUERY_KEY = ["plex-session"] as const;

export async function getPlexSessionRequest() {
	const { data, error } = await getApi().v1.auth.plex.login.me.get();
	if (error?.status === 401) return null;
	if (error) throw new Error("Unable to check your session");
	return data;
}

export async function logoutPlexRequest() {
	const { error } = await getApi().v1.auth.plex.login.logout.post();
	if (error) throw new Error("Unable to sign out");
}

export function plexSessionQueryOptions(state?: string) {
	return queryOptions({
		queryKey: [...PLEX_SESSION_QUERY_KEY, state],
		enabled: typeof window !== "undefined",
		queryFn: async () => {
			if (state) return completePlexLoginRequest(state);
			const user = await getPlexSessionRequest();
			return user
				? { status: "authenticated" as const, user }
				: { status: "anonymous" as const };
		},
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		refetchInterval: (query) =>
			query.state.data?.status === "pending"
				? PLEX_LOGIN_POLL_INTERVAL_MS
				: false,
	});
}

export async function startPlexLoginRequest() {
	const { data, error } = await getApi().v1.auth.plex.login.start.post();
	if (error) {
		throw new Error(PLEX_LOGIN_ERROR_MESSAGE);
	}
	return data;
}

export async function completePlexLoginRequest(state: string) {
	const { data, error } = await getApi().v1.auth.plex.login.complete.post({
		state,
	});
	if (error) {
		throw new Error(PLEX_LOGIN_ERROR_MESSAGE);
	}
	return data;
}
