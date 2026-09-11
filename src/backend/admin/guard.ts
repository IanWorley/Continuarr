import {
	type AdministratorService,
	administratorService,
} from "~/backend/admin/service";

const PUBLIC_ENDPOINTS = new Set([
	"GET /api/v1/health",
	"GET /api/v1/admin/setup",
	"POST /api/v1/admin/bootstrap",
	"POST /api/v1/admin/sign-in",
	"GET /sign-in",
]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function guardRequest(
	request: Request,
	service: AdministratorService = administratorService,
): Response | undefined {
	const url = new URL(request.url);
	// Cookie-authenticated mutations must originate from this installation, including sign-in.
	if (
		!READ_METHODS.has(request.method) &&
		request.headers.get("origin") !== url.origin
	) {
		return Response.json(
			{ error: "A same-origin request is required." },
			{ status: 403 },
		);
	}
	if (PUBLIC_ENDPOINTS.has(`${request.method} ${url.pathname}`)) return;
	if (service.authenticate(request)) return;
	if (url.pathname.startsWith("/api/")) {
		return Response.json({ error: "Sign in to Continuarr." }, { status: 401 });
	}
	return Response.redirect(new URL("/sign-in", url), 303);
}
