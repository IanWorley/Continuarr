import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const READY_ATTEMPTS = 60;
const READY_INTERVAL_MS = 1000;
const PROJECT_ID_LENGTH = 8;
const RESTART_TIMEOUT_SECONDS = 30;
const OWNER_PASSWORD_BYTES = 24;
const DATABASE_PASSWORD_BYTES = 32;
const API_PREFIX = "/api/v1";
const FIXTURE_PASSWORD = randomBytes(OWNER_PASSWORD_BYTES).toString("hex");
const HTTPS_ORIGIN = "https://continuarr.example.test";
const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "continuarr-deployment-"));
const projectPrefix = `continuarr-verify-${randomUUID().slice(0, PROJECT_ID_LENGTH)}`;
const projects: string[] = [];
const projectEnvironments = new Map<string, string>();
const keep = process.env.KEEP_DEPLOYMENT === "1";
const environment: NodeJS.ProcessEnv = {
	...process.env,
	POSTGRES_PASSWORD: randomBytes(DATABASE_PASSWORD_BYTES).toString("hex"),
	CONTINUARR_IMAGE: process.env.CONTINUARR_IMAGE ?? "continuarr:local",
	APP_BIND_ADDRESS: "127.0.0.1",
	CREDENTIAL_ENCRYPTION_KEY: "",
};

async function command(args: string[], env: NodeJS.ProcessEnv = environment) {
	const process = Bun.spawn(args, {
		cwd: root,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [output, error, status] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (status !== 0)
		throw new Error(
			`${args.slice(0, 2).join(" ")} failed (${status})\n${error}\n${output}`,
		);
	return output.trim();
}

function compose(
	project: string,
	args: string[],
	env: NodeJS.ProcessEnv = environment,
) {
	assert(
		project.startsWith(`${projectPrefix}-`),
		"only this run's disposable projects are accessible",
	);
	return command(
		[
			"docker",
			"compose",
			"--env-file",
			"/dev/null",
			"-p",
			project,
			"-f",
			"compose.self-hosted.yaml",
			...args,
		],
		env,
	);
}

function report(check: string, details: object = {}) {
	process.stdout.write(
		`${JSON.stringify({ result: "PASS", check, ...details })}\n`,
	);
}

async function waitReady(base: string) {
	for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(`${base}${API_PREFIX}/health`);
			if (response.ok) {
				assert.deepEqual(await response.json(), {
					application: "Continuarr",
					status: "ok",
				});
				return;
			}
		} catch {}
		await Bun.sleep(READY_INTERVAL_MS);
	}
	throw new Error("Application health did not become ready.");
}

const probeOutput = z
	.object({ keyHash: z.string(), result: z.literal("PASS") })
	.passthrough();
async function probe(project: string, mode: string, prefix?: string) {
	const mounts = [
		"--volume",
		`${join(root, "scripts/deployment-probe.ts")}:/app/scripts/deployment-probe.ts:ro`,
	];
	if (prefix) mounts.push("--volume", `${prefix}:/app/drizzle/postgres:ro`);
	const output = await compose(project, [
		"run",
		"--rm",
		"--no-deps",
		...mounts,
		"app",
		"bun",
		"scripts/deployment-probe.ts",
		mode,
	]);
	const result = probeOutput.parse(JSON.parse(output));
	process.stdout.write(`${output}\n`);
	return result;
}

try {
	const portReservation = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const port = portReservation.port;
	portReservation.stop(true);
	const base = `http://localhost:${port}`;
	Object.assign(environment, { APP_PORT: String(port), PUBLIC_ORIGIN: base });
	const environmentPath = join(temporary, "deployment.env");
	await writeFile(
		environmentPath,
		[
			"POSTGRES_PASSWORD",
			"CONTINUARR_IMAGE",
			"APP_BIND_ADDRESS",
			"APP_PORT",
			"PUBLIC_ORIGIN",
			"CREDENTIAL_ENCRYPTION_KEY",
		]
			.map((key) => `${key}=${environment[key] ?? ""}`)
			.join("\n"),
		{ mode: 0o600 },
	);
	const fresh = `${projectPrefix}-fresh`;
	projects.push(fresh);
	projectEnvironments.set(fresh, environmentPath);
	await compose(fresh, ["up", "-d", "--wait", "postgres"]);
	assert.match(
		await compose(fresh, ["exec", "-T", "postgres", "postgres", "--version"]),
		/PostgreSQL\) 18\./,
	);
	assert.equal(
		await compose(fresh, [
			"run",
			"--rm",
			"--no-deps",
			"app",
			"bun",
			"--version",
		]),
		"1.4.3",
	);
	await compose(fresh, [
		"run",
		"--rm",
		"--no-deps",
		"app",
		"bun",
		"run",
		"db:migrate",
	]);
	await compose(fresh, ["up", "-d", "--no-build", "app"]);
	await waitReady(base);
	const request = (
		path: string,
		body?: object,
		cookie?: string,
		origin = base,
	) =>
		fetch(`${base}${API_PREFIX}${path}`, {
			method: body ? "POST" : "GET",
			headers: {
				"content-type": "application/json",
				origin,
				...(cookie ? { cookie } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			redirect: "manual",
		});
	assert.deepEqual(await (await request("/admin/setup")).json(), {
		configured: false,
	});
	const credentials = {
		username: "deployment-owner",
		password: FIXTURE_PASSWORD,
	};
	assert.equal((await request("/admin/bootstrap", credentials)).status, 201);
	assert.equal((await request("/admin/bootstrap", credentials)).status, 409);
	const signIn = await request("/admin/sign-in", credentials);
	assert.equal(signIn.status, 200);
	const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
	assert(cookie, "sign-in supplies a session cookie");
	const page = await fetch(`${base}/sign-in`);
	const html = await page.text();
	const asset = html.match(/(?:src|href)="(\/assets\/[^"?]+)(?:\?[^"]*)?"/);
	assert(asset, "sign-in references a built static asset");
	const staticResponse = await fetch(`${base}${asset[1]}`);
	assert.equal(staticResponse.status, 200);
	assert.match(
		staticResponse.headers.get("content-type") ?? "",
		/javascript|css/,
	);
	assert((await staticResponse.text()).length > 0, "static asset has content");
	report("fresh install, owner bootstrap, sign-in, health, static asset", {
		project: fresh,
		port,
	});
	const seeded = await probe(fresh, "seed");
	for (const operation of ["restart", "recreate"]) {
		await compose(
			fresh,
			operation === "restart"
				? [
						"restart",
						"--timeout",
						String(RESTART_TIMEOUT_SECONDS),
						"app",
						"postgres",
					]
				: ["up", "-d", "--no-build", "--force-recreate", "postgres", "app"],
		);
		await waitReady(base);
		assert.deepEqual(await (await request("/admin/setup")).json(), {
			configured: true,
		});
		assert.deepEqual(
			await (await request("/admin/session", undefined, cookie)).json(),
			{ authenticated: true },
		);
		assert.equal((await probe(fresh, "check")).keyHash, seeded.keyHash);
		report(`owner, session, key and encrypted credential survive ${operation}`);
	}
	const httpsEnvironment = { ...environment, PUBLIC_ORIGIN: HTTPS_ORIGIN };
	await compose(
		fresh,
		["up", "-d", "--no-build", "--force-recreate", "app"],
		httpsEnvironment,
	);
	await waitReady(base);
	const secureSignIn = await request(
		"/admin/sign-in",
		credentials,
		undefined,
		HTTPS_ORIGIN,
	);
	assert.equal(secureSignIn.status, 200);
	assert.match(secureSignIn.headers.get("set-cookie") ?? "", /; Secure(?:;|$)/);
	assert.equal(
		(
			await request(
				"/admin/sign-in",
				credentials,
				undefined,
				"https://attacker.test",
			)
		).status,
		403,
	);
	const forwarded = await fetch(`${base}${API_PREFIX}/admin/sign-in`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://attacker.test",
			"x-forwarded-host": "attacker.test",
			"x-forwarded-proto": "https",
		},
		body: JSON.stringify(credentials),
	});
	assert.equal(forwarded.status, 403);
	for (const path of [
		"/src/server.ts",
		"/data/credential-encryption.key",
		"/%2e%2e%2fdata/credential-encryption.key",
	]) {
		const response = await fetch(`${base}${path}`, { redirect: "manual" });
		assert.notEqual(response.status, 200, "private files are unavailable");
	}
	report(
		"HTTPS public origin, Secure cookie, rejected cross-origin and spoofed forwarding headers, private file safety",
	);
	if (keep) {
		await compose(fresh, ["up", "-d", "--no-build", "--force-recreate", "app"]);
		await waitReady(base);
	}
	const prefix = join(temporary, "postgres-prefix");
	await cp(join(root, "drizzle/postgres"), prefix, { recursive: true });
	const journalSchema = z
		.object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
		.passthrough();
	const journal = journalSchema.parse(
		await Bun.file(join(prefix, "meta/_journal.json")).json(),
	);
	assert(journal.entries.length > 1, "upgrade needs a previous migration");
	journal.entries.pop();
	await mkdir(join(prefix, "meta"), { recursive: true });
	await writeFile(join(prefix, "meta/_journal.json"), JSON.stringify(journal));
	const upgrade = `${projectPrefix}-upgrade`;
	projects.push(upgrade);
	await compose(upgrade, ["up", "-d", "--wait", "postgres"]);
	await compose(upgrade, [
		"run",
		"--rm",
		"--no-deps",
		"--volume",
		`${prefix}:/app/drizzle/postgres:ro`,
		"app",
		"bun",
		"run",
		"db:migrate",
	]);
	const before = await probe(upgrade, "seed-upgrade", prefix);
	for (let run = 0; run < 2; run++) {
		await compose(upgrade, [
			"run",
			"--rm",
			"--no-deps",
			"app",
			"bun",
			"run",
			"db:migrate",
		]);
		assert.equal(
			(await probe(upgrade, "check-upgrade")).keyHash,
			before.keyHash,
		);
	}
	report(
		"all-but-last journal upgraded, retained rows and credential checked, migration rerun idempotent",
		{ project: upgrade, baselineMigrations: journal.entries.length },
	);
	const upgradeReservation = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const upgradePort = upgradeReservation.port;
	upgradeReservation.stop(true);
	const upgradeBase = `http://localhost:${upgradePort}`;
	const upgradeEnvironment = {
		...environment,
		APP_PORT: String(upgradePort),
		PUBLIC_ORIGIN: upgradeBase,
	};
	const upgradeEnvironmentPath = join(temporary, "upgrade.env");
	await writeFile(
		upgradeEnvironmentPath,
		(await Bun.file(environmentPath).text())
			.replace(/^APP_PORT=.*$/m, `APP_PORT=${upgradePort}`)
			.replace(/^PUBLIC_ORIGIN=.*$/m, `PUBLIC_ORIGIN=${upgradeBase}`),
		{ mode: 0o600 },
	);
	projectEnvironments.set(upgrade, upgradeEnvironmentPath);
	await compose(upgrade, ["up", "-d", "--no-build", "app"], upgradeEnvironment);
	const upgradeAddress = await compose(
		upgrade,
		["port", "app", "3000"],
		upgradeEnvironment,
	);
	await waitReady(upgradeBase);
	assert.deepEqual(
		await (await fetch(`${upgradeBase}${API_PREFIX}/admin/setup`)).json(),
		{ configured: true },
	);
	assert.equal((await probe(upgrade, "check-upgrade")).keyHash, before.keyHash);
	report(
		"upgraded application starts with retained owner and decryptable credentials",
		{ project: upgrade, address: upgradeAddress },
	);
} finally {
	if (keep)
		process.stdout.write(
			`${JSON.stringify({ keptProjects: projects.map((project) => ({ project, environmentFile: projectEnvironments.get(project) ?? join(temporary, "deployment.env") })), instruction: "Use compose.self-hosted.yaml with --env-file and -p for the printed disposable projects. No production volumes were accessed." })}\n`,
		);
	else
		for (const project of projects)
			await compose(project, ["down", "--volumes", "--remove-orphans"]);
}
