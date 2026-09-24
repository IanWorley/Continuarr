import { Elysia, t } from "elysia";
import {
	type AdministratorService,
	MAX_PASSWORD_LENGTH,
	MAX_USERNAME_LENGTH,
	MIN_PASSWORD_LENGTH,
	PasswordDerivationBusyError,
	sessionCookie,
} from "~/backend/admin/service";

const credentials = t.Object({
	username: t.String({
		minLength: 1,
		maxLength: MAX_USERNAME_LENGTH,
		pattern: "^\\S+$",
	}),
	password: t.String({
		minLength: MIN_PASSWORD_LENGTH,
		maxLength: MAX_PASSWORD_LENGTH,
	}),
});

export function administratorRoutes(service: AdministratorService) {
	return new Elysia({ prefix: "/admin" })
		.onError(({ error, status }) => {
			if (error instanceof PasswordDerivationBusyError)
				return status(429, { error: error.message });
		})
		.get("/setup", async () => ({ configured: await service.isConfigured() }))
		.post(
			"/bootstrap",
			async ({ body, status }) => {
				if (!(await service.bootstrap(body.username, body.password)))
					return status(409, {
						error: "The installation owner already exists.",
					});
				return status(201, { configured: true });
			},
			{ body: credentials },
		)
		.post(
			"/sign-in",
			async ({ body, request, set, status }) => {
				const token = await service.signIn(body.username, body.password);
				if (!token)
					return status(401, { error: "Invalid username or password." });
				set.headers["set-cookie"] = sessionCookie(request, token);
				return { authenticated: true };
			},
			{ body: credentials },
		)
		.get("/session", () => ({ authenticated: true }))
		.post("/sign-out", async ({ request, set }) => {
			await service.signOut(request);
			set.headers["set-cookie"] = sessionCookie(request, "", 0);
			return { authenticated: false };
		});
}
