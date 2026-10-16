import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type application from "../src/server";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const NO_REQUEST_TIMEOUT = 0;

const runtimeEnvironment = z.object({
	HOST: z.string().min(1).default(DEFAULT_HOST),
	PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_PORT),
	PUBLIC_ORIGIN: z.url().refine((value) => {
		const url = new URL(value);
		return (
			["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash
		);
	}, "PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment."),
});

export function readRuntimeConfig(environment: NodeJS.ProcessEnv) {
	const config = runtimeEnvironment.parse(environment);
	return {
		hostname: config.HOST,
		port: config.PORT,
		publicOrigin: new URL(config.PUBLIC_ORIGIN),
	};
}

export async function indexClientFiles(directory: string) {
	const root = resolve(directory);
	const files = new Map<string, Bun.BunFile>();
	async function visit(path: string): Promise<void> {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const location = join(path, entry.name);
			if (entry.isDirectory()) await visit(location);
			else if (entry.isFile()) {
				const pathname = `/${relative(root, location).split(sep).map(encodeURIComponent).join("/")}`;
				files.set(pathname, Bun.file(location));
			}
		}
	}
	await visit(root);
	return files;
}

export function createProductionHandler({
	applicationFetch,
	files,
	publicOrigin,
}: {
	applicationFetch: typeof application.fetch;
	files: ReadonlyMap<string, Bun.BunFile>;
	publicOrigin: URL;
}) {
	return async (
		request: Request,
		server: Pick<Bun.Server<undefined>, "timeout">,
	) => {
		const url = new URL(request.url);
		const file = files.get(url.pathname);
		if (file && (request.method === "GET" || request.method === "HEAD")) {
			return new Response(request.method === "HEAD" ? null : file, {
				headers: {
					"content-type": file.type,
					"content-length": String(file.size),
					"cache-control": "public, max-age=0, must-revalidate",
				},
			});
		}
		server.timeout(request, NO_REQUEST_TIMEOUT);
		url.protocol = publicOrigin.protocol;
		url.host = publicOrigin.host;
		url.port = publicOrigin.port;
		return applicationFetch(new Request(url, request));
	};
}
