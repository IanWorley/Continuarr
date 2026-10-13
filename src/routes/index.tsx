import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { DirectoryPolling } from "~/components/media/DirectoryPolling";
import { JellyfinConnect } from "~/components/media/JellyfinConnect";
import { PlexConnect } from "~/components/media/PlexConnect";
import { ErrorMessage, responseData } from "~/components/media/shared";
import { Button, Page } from "~/components/ui";
import { getApi } from "~/routes/api.$";

const STATE_REFRESH_MS = 10_000;
const DIRECTORY_QUERY_KEY = ["jellyfin-directory"];
const STATE_QUERY_KEY = ["media-state"];

const stateQuery = queryOptions({
	queryKey: STATE_QUERY_KEY,
	queryFn: async () => responseData(await getApi().v1.media.state.get()),
	refetchInterval: STATE_REFRESH_MS,
});

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const state = useQuery(stateQuery);
	const directory = useQuery({
		queryKey: DIRECTORY_QUERY_KEY,
		queryFn: async () =>
			responseData(await getApi().v1.media.jellyfin.directory.get()),
		refetchInterval: STATE_REFRESH_MS,
	});
	const queryClient = useQueryClient();
	const refresh = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: STATE_QUERY_KEY }),
			queryClient.invalidateQueries({ queryKey: DIRECTORY_QUERY_KEY }),
		]);
	}, [queryClient]);
	return (
		<Page
			title="Connections & sync"
			description="Keep watched movies and episodes in sync between Plex and Jellyfin, for each person. Connect your servers here, then pair people on the Users page."
		>
			<div className="grid items-start gap-6 lg:grid-cols-2">
				{state.isPending && (
					<p role="status" className="text-sm text-muted">
						Loading Plex connections…
					</p>
				)}
				{state.isError && (
					<div className="space-y-3">
						<ErrorMessage message={state.error.message} />
						<Button onClick={() => void state.refetch()}>Try again</Button>
					</div>
				)}
				{state.data && (
					<PlexConnect
						key={state.data.activePlexAccountId ?? "unlinked"}
						account={state.data.accounts.find(
							(account) => account.id === state.data.activePlexAccountId,
						)}
						servers={state.data.plexServers}
						refresh={refresh}
					/>
				)}
				{directory.isPending && (
					<p role="status" className="text-sm text-muted">
						Loading Jellyfin servers…
					</p>
				)}
				{directory.isError && (
					<ErrorMessage message={directory.error.message} />
				)}
				{directory.data && (
					<JellyfinConnect servers={directory.data.servers} refresh={refresh} />
				)}
			</div>
			{state.data && (
				<DirectoryPolling
					settings={state.data.directoryPolling}
					refresh={refresh}
				/>
			)}
		</Page>
	);
}
