import { Link, type LinkProps } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { getApi } from "~/routes/api.$";

const HTTP_UNAUTHORIZED = 401;
type NavigationDestination = {
	to: LinkProps["to"];
	label: string;
};
const destinations = [
	{ to: "/", label: "Connections & sync" },
	{ to: "/matches", label: "Manual matching" },
] satisfies NavigationDestination[];
const linkClass =
	"rounded-lg px-4 py-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300";

export function AppNavigation() {
	const menu = useRef<HTMLDetailsElement>(null);
	const [signingOut, setSigningOut] = useState(false);
	const [error, setError] = useState("");
	async function signOut() {
		setSigningOut(true);
		setError("");
		try {
			const result = await getApi().v1.admin["sign-out"].post();
			if (result.error && result.status !== HTTP_UNAUTHORIZED)
				throw new Error("Unable to sign out. Please try again.");
			window.location.assign("/sign-in");
		} catch {
			setError("Unable to sign out. Please try again.");
			setSigningOut(false);
		}
	}
	const links = destinations.map(({ to, label }) => (
		<Link
			key={to}
			to={to}
			activeOptions={{ exact: true }}
			className={linkClass}
			activeProps={{
				className:
					"bg-cyan-300/10 text-cyan-200 ring-1 ring-inset ring-cyan-300/30",
				"aria-current": "page",
			}}
			inactiveProps={{
				className: "text-slate-300 hover:bg-slate-800 hover:text-white",
			}}
			onClick={() => {
				if (menu.current) menu.current.open = false;
			}}
		>
			{label}
		</Link>
	));
	const signOutButton = (
		<button
			type="button"
			disabled={signingOut}
			onClick={() => void signOut()}
			className="rounded-lg px-4 py-3 text-left text-sm text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"
		>
			{signingOut ? "Signing out…" : "Sign out"}
		</button>
	);
	return (
		<header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan-300 focus:p-3 focus:text-slate-950"
			>
				Skip to content
			</a>
			<div className="relative mx-auto flex max-w-6xl items-center gap-4 px-5 py-3 sm:px-8">
				<Link
					to="/"
					aria-label="Continuarr home"
					className="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-cyan-300"
				>
					<span
						aria-hidden="true"
						className="grid size-8 place-items-center rounded-lg bg-cyan-300 text-slate-950"
					>
						C
					</span>
					Continuarr
				</Link>
				<nav
					aria-label="Main navigation"
					className="ml-4 hidden items-center gap-2 md:flex"
				>
					{links}
				</nav>
				<div className="ml-auto hidden md:block">{signOutButton}</div>
				<details
					ref={menu}
					className="group ml-auto md:hidden"
					onKeyDown={(event) => {
						if (event.key === "Escape" && menu.current?.open) {
							menu.current.open = false;
							menu.current.querySelector("summary")?.focus();
						}
					}}
				>
					<summary
						aria-label="Navigation menu"
						className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-300 [&::-webkit-details-marker]:hidden"
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="size-5 group-open:hidden"
						>
							<path d="M4 6h16M4 12h16M4 18h16" />
						</svg>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="hidden size-5 group-open:block"
						>
							<path d="m6 6 12 12M18 6 6 18" />
						</svg>
					</summary>
					<nav
						aria-label="Mobile navigation"
						className="absolute inset-x-0 top-full grid gap-2 border-b border-slate-700 bg-slate-950 p-4 shadow-xl"
					>
						{links}
						<div className="mt-1 grid border-t border-slate-800 pt-2">
							{signOutButton}
						</div>
					</nav>
				</details>
			</div>
			{error && (
				<p
					role="alert"
					className="mx-auto max-w-6xl px-5 pb-3 text-sm text-red-300"
				>
					{error}
				</p>
			)}
		</header>
	);
}
