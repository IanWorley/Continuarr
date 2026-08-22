import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { getApi } from "~/routes/api.$";

const HEALTH_QUERY_KEY = ["health"] as const;

const healthQueryOptions = queryOptions({
	queryFn: async () => {
		const response = await getApi().health.get();

		if (response.error) {
			throw response.error;
		}

		return response.data;
	},
	queryKey: HEALTH_QUERY_KEY,
});

export const Route = createFileRoute("/")({
	component: Home,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(healthQueryOptions),
});

function Home() {
	const { data: health } = useSuspenseQuery(healthQueryOptions);

	return (
		<main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-16">
			<section className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-black/20">
				<p className="mb-3 text-sm font-semibold tracking-widest text-cyan-400 uppercase">
					System ready
				</p>
				<h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
					{health.application}
				</h1>
				<p className="mt-4 text-lg text-slate-300">
					TanStack Start, Query, Elysia, Eden, and Tailwind CSS are connected.
				</p>
				<div className="mt-8 flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-3">
					<span className="size-3 rounded-full bg-emerald-400" />
					<span className="text-sm text-slate-400">API status</span>
					<strong className="ml-auto text-emerald-400">{health.status}</strong>
				</div>
			</section>
		</main>
	);
}
