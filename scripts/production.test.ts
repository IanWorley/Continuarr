import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createProductionHandler,
	indexClientFiles,
	readRuntimeConfig,
} from "./production";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("production boundary", () => {
	test("rejects an origin with a path or credentials and an invalid port", () => {
		for (const PUBLIC_ORIGIN of [
			"https://example.test/path",
			"https://user:pass@example.test",
			"file:///data",
			"https://example.test?query=1",
		]) {
			expect(() => readRuntimeConfig({ PUBLIC_ORIGIN })).toThrow();
		}
		expect(() =>
			readRuntimeConfig({
				PUBLIC_ORIGIN: "https://example.test",
				PORT: "70000",
			}),
		).toThrow();
		expect(
			readRuntimeConfig({ PUBLIC_ORIGIN: "https://example.test", PORT: "8080" })
				.port,
		).toBe(8080);
	});

	test("preserves a POST body and query while ignoring forwarding headers", async () => {
		const handler = createProductionHandler({
			files: new Map(),
			publicOrigin: new URL("https://continuarr.example.test"),
			applicationFetch: async (request) =>
				Response.json({
					url: request.url,
					body: await request.text(),
					origin: request.headers.get("origin"),
				}),
		});
		const request = new Request(
			"http://internal.test:3000/api/v1/admin/sign-in?next=%2Fusers",
			{
				method: "POST",
				body: '{"username":"owner"}',
				headers: {
					origin: "https://continuarr.example.test",
					"x-forwarded-host": "attacker.test",
					"x-forwarded-proto": "http",
				},
			},
		);
		const timeouts: number[] = [];
		const response = await handler(request, {
			timeout: (_, seconds) => {
				timeouts.push(seconds);
			},
		});
		expect(await response.json()).toEqual({
			url: "https://continuarr.example.test/api/v1/admin/sign-in?next=%2Fusers",
			body: '{"username":"owner"}',
			origin: "https://continuarr.example.test",
		});
		expect(timeouts).toEqual([0]);
	});

	test("uses the configured public port instead of the internal listener port", async () => {
		const handler = createProductionHandler({
			files: new Map(),
			publicOrigin: new URL("https://continuarr.example.test:8443"),
			applicationFetch: async (request) => new Response(request.url),
		});
		const response = await handler(
			new Request("http://internal.test:3000/sign-in?next=%2Fusers"),
			{ timeout: () => {} },
		);
		expect(await response.text()).toBe(
			"https://continuarr.example.test:8443/sign-in?next=%2Fusers",
		);
	});

	test("serves GET and HEAD assets but delegates symlinks, traversal, and POST", async () => {
		const directory = await mkdtemp(join(tmpdir(), "continuarr-static-"));
		directories.push(directory);
		const client = join(directory, "client");
		await mkdir(client);
		await writeFile(join(client, "app.js"), "export default 42;");
		await writeFile(join(directory, "private.key"), "private credential");
		await symlink(join(directory, "private.key"), join(client, "leaked.key"));
		const handler = createProductionHandler({
			files: await indexClientFiles(client),
			publicOrigin: new URL("https://example.test"),
			applicationFetch: async () =>
				new Response("application", { status: 404 }),
		});
		const server = { timeout: () => {} };
		const asset = await handler(new Request("http://internal/app.js"), server);
		expect(await asset.text()).toBe("export default 42;");
		expect(asset.headers.get("content-type")).toContain("javascript");
		const head = await handler(
			new Request("http://internal/app.js", { method: "HEAD" }),
			server,
		);
		expect(await head.text()).toBe("");
		expect(head.headers.get("content-length")).toBe("18");
		for (const path of [
			"/leaked.key",
			"/%2e%2e/private.key",
			"/%2e%2e%2fprivate.key",
			"/src/server.ts",
			"/data/credential-encryption.key",
		]) {
			const response = await handler(
				new Request(`http://internal${path}`),
				server,
			);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("application");
		}
		const post = await handler(
			new Request("http://internal/app.js", {
				method: "POST",
				body: "payload",
			}),
			server,
		);
		expect(await post.text()).toBe("application");
	});
});
