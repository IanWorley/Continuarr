import { fileURLToPath } from "node:url";
import {
	createProductionHandler,
	indexClientFiles,
	readRuntimeConfig,
} from "./production";

const config = readRuntimeConfig(process.env);
const build = new URL("../dist/server/server.js", import.meta.url).href;
const {
	default: application,
}: { default: typeof import("../src/server").default } = await import(build);
const files = await indexClientFiles(
	fileURLToPath(new URL("../dist/client", import.meta.url)),
);
const server = Bun.serve({
	hostname: config.hostname,
	port: config.port,
	fetch: createProductionHandler({
		applicationFetch: application.fetch,
		files,
		publicOrigin: config.publicOrigin,
	}),
});

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
for (const signal of SHUTDOWN_SIGNALS) {
	process.once(signal, () => {
		server.stop(true);
		process.exit(0);
	});
}
