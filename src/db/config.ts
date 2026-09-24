export const DEFAULT_DATABASE_URL =
	"postgresql://continuarr:continuarr@localhost:5432/continuarr";
export const DEFAULT_DATA_DIRECTORY = "./data";

export function getDatabaseUrl() {
	const value = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
	}
	if (!["postgres:", "postgresql:"].includes(url.protocol))
		throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
	return value;
}

export function getDataDirectory() {
	return process.env.DATA_DIRECTORY ?? DEFAULT_DATA_DIRECTORY;
}
