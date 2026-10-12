import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { DirectoryPolling } from "~/components/media/DirectoryPolling";
import { JellyfinConnect } from "~/components/media/JellyfinConnect";
import { PlexConnect } from "~/components/media/PlexConnect";
import {
	ErrorMessage,
	jellyfinDirectoryQuery,
	mediaStateQuery,
} from "~/components/media/shared";
import { Button, Page } from "~/components/ui";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const state = useQuery(mediaStateQuery);
	const directory = useQuery(jellyfinDirectoryQuery);
	const queryClient = useQueryClient();
	const refresh = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: mediaStateQuery.queryKey }),
			queryClient.invalidateQueries({
				queryKey: jellyfinDirectoryQuery.queryKey,
			}),
		]);
	}, [queryClient]);
	return (
		<Page
			title="Connections & sync"
			description={
				<>
					Save your Plex and Jellyfin servers to import their users. Then pair
					people on{" "}
					<Link to="/users" className="text-ink underline underline-offset-4">
						Users
					</Link>
					.
				</>
			}
		>
			{state.isPending && (
				<p role="status" className="text-sm text-muted">
					Loading Plex connections…
				</p>
			)}
			{state.isError && (
				<div className="grid justify-items-start gap-3">
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
			{directory.isError && <ErrorMessage message={directory.error.message} />}
			{directory.data && (
				<JellyfinConnect servers={directory.data.servers} refresh={refresh} />
			)}
			{state.data && (
				<DirectoryPolling
					key={`${state.data.directoryPolling.enabled}:${state.data.directoryPolling.intervalMinutes}`}
					settings={state.data.directoryPolling}
					refresh={refresh}
				/>
			)}
		</Page>
	);
}
