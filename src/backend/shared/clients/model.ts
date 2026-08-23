import { z } from "zod";

export const plexOauthDataSchema = z.object({
	code: z.string().describe("The code to use to authenticate with Plex"),
	expiresAt: z.iso.datetime().describe("The expiration time of the code"),
	expiresIn: z.number().optional().describe("Seconds until the PIN expires"),
	token: z
		.string()
		.nullable()
		.optional()
		.describe("Present after the user authorizes"),
	authorizationUrl: z
		.string()
		.describe("The URL to use to authenticate with Plex"),
});

export const plexOauthSchema = z
	.discriminatedUnion("success", [
		z.object({
			success: z.literal(false),
			data: z.null(),
		}),
		z.object({
			success: z.literal(true),
			data: plexOauthDataSchema,
		}),
	])
	.describe("The Plex OAuth response");

export type PlexOauth = z.infer<typeof plexOauthSchema>;
