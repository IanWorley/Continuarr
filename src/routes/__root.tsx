import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	redirect,
	Scripts,
} from "@tanstack/react-router";

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
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
