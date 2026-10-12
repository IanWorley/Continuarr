import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	redirect,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import brandMarkUrl from "~/assets/brand-mark.svg?url";
import { AppNavigation } from "~/components/app-navigation";
import { getApi } from "~/routes/api.$";
import appCss from "~/styles.css?url";

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async ({ location }) => {
		if (location.pathname === "/sign-in") return;
		const { error } = await getApi().v1.admin.session.get();
		if (error) throw redirect({ to: "/sign-in" });
	},
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Continuarr",
			},
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: brandMarkUrl,
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	component: RootLayout,
	shellComponent: RootDocument,
});

function RootLayout() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (pathname === "/sign-in") return <Outlet />;
	return (
		<>
			<AppNavigation key={pathname} />
			<div className="md:pl-60">
				<Outlet />
			</div>
		</>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-canvas font-sans text-ink antialiased">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
