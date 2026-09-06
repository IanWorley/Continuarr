import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JellyfinOverview } from "~/backend/jellyfin/client";
import { getApi } from "~/routes/api.$";

const MUTATION_OPTIONS = { headers: { "x-continuarr-request": "1" } };
const UNAUTHORIZED = 401;
const INPUT_STYLE =
	"mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2";
const BUTTON_STYLE =
	"rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50";
const NETWORK_ERROR = "Unable to reach Continuarr. Please try again.";

export const Route = createFileRoute("/jellyfin/")({ component: JellyfinPage });

function JellyfinPage() {
	const [overview, setOverview] = useState<JellyfinOverview | null>(null);
	const [connected, setConnected] = useState(false);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		getApi()
			.v1.auth.jellyfin.overview.get()
			.then((response) => {
				if (!active) return;
				if (response.error) {
					if (response.error.status !== UNAUTHORIZED) {
						setConnected(true);
						setError("Unable to load your instance. Try refreshing.");
					}
				} else {
					setConnected(true);
					setOverview(response.data);
				}
			})
			.catch(() => {
				if (active) setError(NETWORK_ERROR);
			})
			.finally(() => {
				if (active) setBusy(false);
			});
		return () => {
			active = false;
		};
	}, []);

	async function refresh() {
		setBusy(true);
		setError(null);
		try {
			const response = await getApi().v1.auth.jellyfin.overview.get();
			if (response.error) {
				if (response.error.status === UNAUTHORIZED) {
					setConnected(false);
					setOverview(null);
					setError("Your Jellyfin session expired. Please log in again.");
				} else setError("Unable to load your instance. Try refreshing.");
			} else setOverview(response.data);
		} catch {
			setError(NETWORK_ERROR);
		} finally {
			setBusy(false);
		}
	}

	async function login(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const fields = new FormData(form);
		setBusy(true);
		setError(null);
		try {
			const response = await getApi().v1.auth.jellyfin.login.post(
				{
					serverUrl: String(fields.get("serverUrl")).trim(),
					username: String(fields.get("username")).trim(),
					password: String(fields.get("password")),
				},
				MUTATION_OPTIONS,
			);
			if (response.error) {
				setError(
					response.error.status === UNAUTHORIZED
						? "Jellyfin rejected your username or password."
						: "Unable to log in. Check the server URL and try again.",
				);
				return;
			}
			form.reset();
			setConnected(true);
			await refresh();
		} catch {
			setError(NETWORK_ERROR);
		} finally {
			setBusy(false);
		}
	}

	async function logout() {
		setBusy(true);
		setError(null);
		try {
			const response = await getApi().v1.auth.jellyfin.logout.post(
				undefined,
				MUTATION_OPTIONS,
			);
			if (response.error) {
				setError("Unable to log out. Please try again.");
				return;
			}
			setConnected(false);
			setOverview(null);
		} catch {
			setError(NETWORK_ERROR);
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="mx-auto max-w-3xl px-6 py-16">
			<Link to="/" className="text-cyan-400">
				Back to Continuarr
			</Link>
			<h1 className="mt-6 text-4xl font-bold">Jellyfin</h1>
			<p className="mt-3 text-slate-300">
				Connect your instance to browse your libraries and recently added media.
			</p>
			{error && (
				<p role="alert" className="mt-6 rounded-lg bg-red-950 p-4 text-red-200">
					{error}
				</p>
			)}
			{busy && (
				<p role="status" className="mt-4 text-slate-400">
					Loading Jellyfin…
				</p>
			)}
			{!connected ? (
				<form
					onSubmit={login}
					className="mt-8 space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6"
				>
					<fieldset disabled={busy} className="space-y-5">
						<label className="block">
							Server URL
							<input
								className={INPUT_STYLE}
								name="serverUrl"
								type="url"
								placeholder="http://localhost:8096"
								required
							/>
						</label>
						<label className="block">
							Username
							<input
								className={INPUT_STYLE}
								name="username"
								autoComplete="username"
								required
							/>
						</label>
						<label className="block">
							Password
							<input
								className={INPUT_STYLE}
								name="password"
								type="password"
								autoComplete="current-password"
							/>
						</label>
						<button className={BUTTON_STYLE} type="submit" disabled={busy}>
							Log in
						</button>
					</fieldset>
				</form>
			) : (
				<>
					<div className="my-6 flex gap-3">
						<button
							className={BUTTON_STYLE}
							type="button"
							onClick={refresh}
							disabled={busy}
						>
							Refresh
						</button>
						<button
							className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-50"
							type="button"
							onClick={logout}
							disabled={busy}
						>
							Log out
						</button>
					</div>
					{overview && (
						<>
							<section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
								<h2 className="text-2xl font-semibold">
									{overview.server.name}
								</h2>
								<p className="mt-2 break-all text-slate-300">
									{overview.server.url}
								</p>
								<p className="mt-2 text-slate-400">
									Version {overview.server.version} · Signed in as{" "}
									{overview.user.name}
								</p>
							</section>
							<MediaList
								title="Libraries"
								items={overview.libraries}
								empty="No libraries are available to this user."
							/>
							<MediaList
								title="Recently added"
								items={overview.recent}
								empty="No recently added media."
							/>
						</>
					)}
				</>
			)}
		</main>
	);
}

function MediaList({
	title,
	items,
	empty,
}: {
	title: string;
	items: JellyfinOverview["recent"];
	empty: string;
}) {
	return (
		<section className="mt-8">
			<h2 className="text-xl font-semibold">{title}</h2>
			{items.length === 0 ? (
				<p className="mt-3 text-slate-400">{empty}</p>
			) : (
				<ul className="mt-3 grid gap-3 sm:grid-cols-2">
					{items.map((item) => (
						<li
							key={item.id}
							className="rounded-lg border border-slate-800 p-4"
						>
							<p className="font-medium">{item.name}</p>
							<p className="mt-1 text-sm text-slate-400">
								{[item.type, item.year].filter(Boolean).join(" · ")}
							</p>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
