import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/plex/")({
	beforeLoad: () => {
		throw redirect({ to: "/" });
	},
});
