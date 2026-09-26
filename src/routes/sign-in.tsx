import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	MAX_PASSWORD_LENGTH,
	MAX_USERNAME_LENGTH,
	MIN_PASSWORD_LENGTH,
} from "~/backend/admin/model";
import { getApi } from "~/routes/api.$";

const HTTP_CONFLICT = 409;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const FIELD_CLASS_NAME =
	"mt-2 block w-full rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 hover:border-slate-500 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10 aria-invalid:border-rose-400/70 aria-invalid:focus:ring-rose-400/10 read-only:opacity-60";

type Credentials = { username: string; password: string };

function readCredentials(form: HTMLFormElement): Credentials {
	const data = new FormData(form);
	return {
		username: String(data.get("username") ?? ""),
		password: String(data.get("password") ?? ""),
	};
}

function validateCredentials(credentials: Credentials) {
	return {
		username: !credentials.username
			? "Enter your username."
			: /\s/.test(credentials.username)
				? "Your username cannot contain spaces."
				: credentials.username.length > MAX_USERNAME_LENGTH
					? `Use ${MAX_USERNAME_LENGTH} characters or fewer.`
					: "",
		password: !credentials.password
			? "Enter your password."
			: credentials.password.length < MIN_PASSWORD_LENGTH
				? `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`
				: credentials.password.length > MAX_PASSWORD_LENGTH
					? `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`
					: "",
	};
}

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
	const [fieldErrors, setFieldErrors] = useState({
		username: "",
		password: "",
	});
	const [touched, setTouched] = useState({ username: false, password: false });

	async function submit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const credentials = readCredentials(event.currentTarget);
		const fieldErrors = validateCredentials(credentials);
		setFieldErrors(fieldErrors);
		setTouched({ username: true, password: true });
		if (fieldErrors.username || fieldErrors.password) {
			const field = fieldErrors.username ? "username" : "password";
			event.currentTarget
				.querySelector<HTMLInputElement>(`[name="${field}"]`)
				?.focus();
			return;
		}
		setPending(true);
		setError("");
		try {
			if (!configured) {
				const result = await getApi().v1.admin.bootstrap.post(credentials);
				if (result.error) {
					if (result.status !== HTTP_CONFLICT) {
						throw new Error(
							result.status === HTTP_TOO_MANY_REQUESTS
								? "Owner setup is busy right now. Wait a moment and try again."
								: "Unable to create the owner. Please try again in a moment.",
						);
					}
				}
				setConfigured(true);
			}
			const result = await getApi().v1.admin["sign-in"].post(credentials);
			if (result.error) {
				throw new Error(
					result.status === HTTP_UNAUTHORIZED
						? "That username and password don't match. Check your details and try again."
						: result.status === HTTP_TOO_MANY_REQUESTS
							? "Sign-in is busy right now. Wait a moment and try again."
							: "We couldn't sign you in. Please try again in a moment.",
				);
			}
			window.location.assign("/");
		} catch (cause) {
			setError(
				cause instanceof TypeError
					? "We couldn't reach Continuarr. Check your connection and try again."
					: cause instanceof Error
						? cause.message
						: "We couldn't sign you in. Please try again.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<main className="flex min-h-svh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(8,145,178,0.10),transparent_60%)] px-5 py-12">
			<div className="mb-8 flex items-center gap-3">
				<span
					aria-hidden="true"
					className="flex size-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-lg font-semibold text-cyan-300"
				>
					C
				</span>
				<span className="text-lg font-semibold tracking-tight">Continuarr</span>
			</div>
			<section
				aria-labelledby="sign-in-title"
				className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 sm:p-9"
			>
				<p className="mb-3 text-xs font-medium tracking-widest text-cyan-300 uppercase">
					{configured ? "Your media, in sync" : "Welcome to Continuarr"}
				</p>
				<h1
					id="sign-in-title"
					className="text-3xl font-semibold tracking-tight"
				>
					{configured ? "Welcome back" : "Make yourself at home"}
				</h1>
				<p className="mt-3 text-sm leading-6 text-slate-400">
					{configured
						? "Sign in with your installation-owner account."
						: "Create your installation-owner account. This is separate from your Plex or Jellyfin account."}
				</p>
				<form
					noValidate
					onSubmit={submit}
					onChange={(event) => {
						setFieldErrors(
							validateCredentials(readCredentials(event.currentTarget)),
						);
						setError("");
					}}
					onBlur={(event) => {
						const field = event.target;
						if (
							field instanceof HTMLInputElement &&
							(field.name === "username" || field.name === "password")
						) {
							const name = field.name;
							setTouched((current) => ({ ...current, [name]: true }));
							setFieldErrors(
								validateCredentials(readCredentials(event.currentTarget)),
							);
						}
					}}
					aria-busy={pending}
					className="mt-8 flex flex-col gap-5"
				>
					<div>
						<label
							htmlFor="username"
							className="text-sm font-medium text-slate-200"
						>
							Username
						</label>
						<input
							id="username"
							name="username"
							required
							maxLength={MAX_USERNAME_LENGTH}
							pattern="\S+"
							autoComplete="username"
							autoCapitalize="none"
							spellCheck={false}
							placeholder="Your username"
							readOnly={pending}
							aria-invalid={touched.username && !!fieldErrors.username}
							aria-describedby={
								touched.username && fieldErrors.username
									? "username-error"
									: undefined
							}
							className={FIELD_CLASS_NAME}
						/>
						{touched.username && fieldErrors.username && (
							<p
								id="username-error"
								role="alert"
								className="mt-2 text-xs leading-5 text-rose-300"
							>
								{fieldErrors.username}
							</p>
						)}
					</div>
					<div>
						<label
							htmlFor="password"
							className="text-sm font-medium text-slate-200"
						>
							Password
						</label>
						<input
							id="password"
							name="password"
							type="password"
							required
							minLength={MIN_PASSWORD_LENGTH}
							maxLength={MAX_PASSWORD_LENGTH}
							autoComplete={configured ? "current-password" : "new-password"}
							placeholder="Your password"
							readOnly={pending}
							aria-invalid={touched.password && !!fieldErrors.password}
							aria-describedby={
								touched.password && fieldErrors.password
									? "password-error"
									: !configured
										? "password-hint"
										: undefined
							}
							className={FIELD_CLASS_NAME}
						/>
						{touched.password && fieldErrors.password ? (
							<p
								id="password-error"
								role="alert"
								className="mt-2 text-xs leading-5 text-rose-300"
							>
								{fieldErrors.password}
							</p>
						) : (
							!configured && (
								<p
									id="password-hint"
									className="mt-2 text-xs leading-5 text-slate-400"
								>
									Use {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters.
								</p>
							)
						)}
					</div>
					{error && (
						<div
							role="alert"
							className="rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm leading-6 text-rose-200"
						>
							{error}
						</div>
					)}
					<button
						type="submit"
						disabled={pending}
						className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 active:bg-cyan-400 disabled:cursor-wait disabled:opacity-60"
					>
						{pending
							? "Signing you in…"
							: configured
								? "Sign in"
								: "Create owner and sign in"}
						{!pending && <span aria-hidden="true">→</span>}
					</button>
				</form>
			</section>
			<p className="mt-6 text-xs text-slate-500">
				One place for your Plex and Jellyfin sync.
			</p>
		</main>
	);
}
