import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEVELOPMENT_SERVER_PORT = 3000;

const config = defineConfig({
	optimizeDeps: {
		exclude: ["pg"],
	},
	plugins: [tailwindcss(), tanstackStart(), viteReact()],
	resolve: { tsconfigPaths: true },
	server: { port: DEVELOPMENT_SERVER_PORT },
	ssr: {
		external: ["pg"],
	},
});

export default config;
