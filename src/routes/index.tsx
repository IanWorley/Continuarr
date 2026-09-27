import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { JellyfinConnect } from "~/components/media/JellyfinConnect";
import { PlexConnect } from "~/components/media/PlexConnect";
import {
	ErrorMessage,
	responseData,
	secondaryClass,
} from "~/components/media/shared";
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
		<main
			id="main-content"
			tabIndex={-1}
			className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12"
		>
			<header className="mb-10 flex items-start justify-between gap-6 border-b border-slate-800 pb-7">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
						Your libraries, together
					</p>
					<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
						Connections &amp; sync
					</h1>
					<p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
						Keep watched movies and episodes in sync between Plex and Jellyfin,
						for each person.
					</p>
				</div>
			</header>
			<section aria-labelledby="connections-heading">
				<div className="mb-5">
					<h2 id="connections-heading" className="text-xl font-semibold">
						Connect your servers
					</h2>
					<p className="mt-1 text-sm text-slate-400">
						Connect your servers here, then pair people and sync watched status
						on the Users page.
					</p>
				</div>
				<div className="grid items-start gap-5 lg:grid-cols-2">
					{state.isPending && <p role="status">Loading Plex connections…</p>}
					{state.isError && (
						<div className="space-y-3">
							<ErrorMessage message={state.error.message} />
							<button
								type="button"
								className={secondaryClass}
								onClick={() => void state.refetch()}
							>
								Try again
							</button>
						</div>
					)}
					{state.data && (
						<PlexConnect
							key={state.data.activePlexAccountId ?? "unlinked"}
							account={state.data.accounts.find(
								(account) => account.id === state.data.activePlexAccountId,
							)}
							profiles={state.data.plexProfiles}
							refresh={refresh}
						/>
					)}
					{directory.isPending && (
						<p role="status">Loading Jellyfin servers…</p>
					)}
					{directory.isError && (
						<ErrorMessage message={directory.error.message} />
					)}
					{directory.data && (
						<JellyfinConnect
							servers={directory.data.servers}
							refresh={refresh}
						/>
					)}
				</div>
			</section>
		</main>
	);
}
