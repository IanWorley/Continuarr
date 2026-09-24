import { Elysia, t } from "elysia";
import { MediaError } from "./model";
import type { MediaService } from "./service";

const id = t.String({ minLength: 1, maxLength: 200 });
export function mediaRoutes(
	service?: MediaService | (() => Promise<MediaService>),
) {
	const getService = async () => {
		if (!service) throw new MediaError("Media service is not configured.", 502);
		return typeof service === "function" ? await service() : service;
	};
	return new Elysia({ prefix: "/media" })
		.onError(({ error, status }) => {
			if (error instanceof MediaError)
				return status(error.status, { error: error.message });
			if ("code" in error && error.code === "VALIDATION")
				return status(400, { error: "Check the submitted fields." });
			return status(502, {
				error:
					"Unable to contact the media service. Check the connection and try again.",
			});
		})
		.get("/state", async () => (await getService()).state())
		.post("/plex/start", async () => (await getService()).startLogin())
		.post(
			"/plex/poll",
			async ({ body }) => (await getService()).pollLogin(body.id),
			{
				body: t.Object({ id }),
			},
		)
		.get("/plex/:id/users", async ({ params }) =>
			(await getService()).homeUsers(params.id),
		)
		.post(
			"/plex/select",
			async ({ body }) => (await getService()).selectProfile(body),
			{
				body: t.Object({
					accountId: id,
					userId: id,
					pin: t.Optional(t.String({ maxLength: 20 })),
				}),
			},
		)
		.post(
			"/plex/connect",
			async ({ body }) => (await getService()).connectPlex(body),
			{
				body: t.Object({
					selectionId: id,
					serverId: id,
					url: t.String({ minLength: 1, maxLength: 2048 }),
				}),
			},
		)
		.post(
			"/jellyfin/connect",
			async ({ body }) => (await getService()).connectJellyfin(body),
			{
				body: t.Object({
					url: t.String({ minLength: 1, maxLength: 2048 }),
					username: t.String({ minLength: 1, maxLength: 200 }),
					password: t.String({ maxLength: 1024 }),
				}),
			},
		)
		.post(
			"/pairings",
			async ({ body }) => (await getService()).addPairing(body),
			{
				body: t.Object({ plexProfileId: id, jellyfinProfileId: id }),
			},
		)
		.post(
			"/pairings/:id/automatic",
			async ({ params, body }) =>
				(await getService()).automatic(params.id, body.enabled),
			{ body: t.Object({ enabled: t.Boolean() }) },
		)
		.post("/pairings/:id/preview", async ({ params }) =>
			(await getService()).preview(params.id),
		)
		.post("/pairings/:id/run", async ({ params }) =>
			(await getService()).run(params.id),
		);
}
