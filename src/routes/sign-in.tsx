import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	MAX_PASSWORD_LENGTH,
	MAX_USERNAME_LENGTH,
	MIN_PASSWORD_LENGTH,
} from "~/backend/admin/model";
import { getApi } from "~/routes/api.$";

const HTTP_CONFLICT = 409;

export const Route = createFileRoute("/sign-in")({
	loader: async () => {
		const { data, error } = await getApi().v1.admin.setup.get();
		if (error) throw new Error("Unable to read installation status.");
		return data;
	},
	component: SignIn,
});

function SignIn() {
	const initial = Route.useLoaderData();
	const [configured, setConfigured] = useState(initial.configured);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const credentials = {
			username: String(form.get("username")),
			password: String(form.get("password")),
		};
		setPending(true);
		setError("");
		try {
			if (!configured) {
				const result = await getApi().v1.admin.bootstrap.post(credentials);
				if (result.error) {
					if (result.status === HTTP_CONFLICT) setConfigured(true);
					throw new Error(
						"Unable to create the owner. The installation may already be configured.",
					);
				}
				setConfigured(true);
			}
			const result = await getApi().v1.admin["sign-in"].post(credentials);
			if (result.error)
				throw new Error("Unable to sign in. Check your username and password.");
			window.location.assign("/");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Unable to sign in.");
		} finally {
			setPending(false);
		}
	}

	return (
		<main className="mx-auto max-w-md px-6 py-16">
			<h1 className="mb-6 text-3xl font-bold">
				{configured ? "Sign in to Continuarr" : "Set up Continuarr"}
			</h1>
			<p className="mb-6 text-slate-300">
				{configured
					? "Use your installation-owner account."
					: "Create the single installation-owner account. This is separate from your Plex or Jellyfin account."}
			</p>
			<form onSubmit={submit} className="flex flex-col gap-4">
				<label>
					Username
					<input
						name="username"
						required
						maxLength={MAX_USERNAME_LENGTH}
						pattern="\S+"
						autoComplete="username"
						className="mt-1 block w-full rounded bg-slate-800 p-3"
					/>
				</label>
				<label>
					Password
					<input
						name="password"
						type="password"
						required
						minLength={MIN_PASSWORD_LENGTH}
						maxLength={MAX_PASSWORD_LENGTH}
						autoComplete={configured ? "current-password" : "new-password"}
						className="mt-1 block w-full rounded bg-slate-800 p-3"
					/>
				</label>
				{!configured && (
					<p className="text-sm text-slate-400">
						Use {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters for your
						password.
					</p>
				)}
				{error && (
					<p role="alert" className="text-red-400">
						{error}
					</p>
				)}
				<button
					type="submit"
					disabled={pending}
					className="rounded bg-cyan-700 p-3 disabled:opacity-50"
				>
					{pending
						? "Please wait…"
						: configured
							? "Sign in"
							: "Create owner and sign in"}
				</button>
			</form>
		</main>
	);
}
