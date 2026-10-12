import { Link, type LinkProps } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { BrandMark, focusRing } from "~/components/ui";
import { getApi } from "~/routes/api.$";

const HTTP_UNAUTHORIZED = 401;
type NavigationDestination = {
	to: LinkProps["to"];
	label: string;
};
const destinations = [
	{ to: "/", label: "Connections & sync" },
	{ to: "/users", label: "Users" },
	{ to: "/matches", label: "Manual matching" },
] satisfies NavigationDestination[];
const itemClass = `flex min-h-9 items-center rounded-md pointer-coarse:min-h-11 px-3 text-sm transition ${focusRing}`;

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
			className={itemClass}
			activeProps={{
				className: "bg-raised font-medium text-ink",
				"aria-current": "page",
			}}
			inactiveProps={{
				className: "text-muted hover:bg-raised/60 hover:text-ink",
			}}
			onClick={() => {
				if (menu.current) menu.current.open = false;
			}}
		>
			{label}
		</Link>
	));
	const footer = (
		<div className="grid gap-2 border-t border-line pt-3">
			<button
				type="button"
				disabled={signingOut}
				onClick={() => void signOut()}
				className={`${itemClass} cursor-pointer text-muted hover:bg-raised/60 hover:text-ink disabled:opacity-50`}
			>
				{signingOut ? "Signing out…" : "Sign out"}
			</button>
			{error && (
				<p role="alert" className="px-3 text-xs text-red-300">
					{error}
				</p>
			)}
		</div>
	);
	const brand = (
		<Link
			to="/"
			aria-label="Continuarr home"
			className={`flex items-center gap-2.5 rounded-md text-[15px] font-semibold tracking-tight ${focusRing}`}
		>
			<BrandMark />
			Continuarr
		</Link>
	);
	return (
		<>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-canvas"
			>
				Skip to content
			</a>
			<aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-canvas px-3 py-5 md:flex">
				<div className="px-3">{brand}</div>
				<nav aria-label="Main navigation" className="mt-8 grid gap-0.5">
					{links}
				</nav>
				<div className="mt-auto">{footer}</div>
			</aside>
			<header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-canvas/95 px-5 py-3 backdrop-blur md:hidden">
				{brand}
				<details
					ref={menu}
					className="group"
					onKeyDown={(event) => {
						if (event.key === "Escape" && menu.current?.open) {
							menu.current.open = false;
							menu.current.querySelector("summary")?.focus();
						}
					}}
				>
					<summary
						aria-label="Navigation menu"
						className={`flex size-9 cursor-pointer pointer-coarse:size-11 list-none items-center justify-center rounded-md border border-line-strong text-muted hover:text-ink [&::-webkit-details-marker]:hidden ${focusRing}`}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="size-4 group-open:hidden"
						>
							<path d="M4 7h16M4 12h16M4 17h16" />
						</svg>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="hidden size-4 group-open:block"
						>
							<path d="m6 6 12 12M18 6 6 18" />
						</svg>
					</summary>
					<nav
						aria-label="Mobile navigation"
						className="absolute inset-x-0 top-full grid gap-0.5 border-b border-line bg-canvas p-3 shadow-2xl shadow-black/40"
					>
						{links}
						<div className="mt-2">{footer}</div>
					</nav>
				</details>
			</header>
		</>
	);
}
