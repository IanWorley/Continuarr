import { z } from "zod";

export const plexPinSchema = z.object({
	authToken: z.string().nullable().optional(),
	code: z.string().min(1),
	expiresAt: z.iso.datetime(),
	expiresIn: z.number().optional(),
	id: z.number().int().positive(),
});

export const plexDeviceAuthSchema = z.object({
	authToken: z.string().min(1),
	clientIdentifier: z.string().optional(),
	jwt: z.string().min(1),
});

export const plexAccountSchema = z.object({
	friendlyName: z.string(),
	id: z.number().int().positive(),
	title: z.string(),
});

export type PlexPin = z.infer<typeof plexPinSchema>;
export type PlexAccount = z.infer<typeof plexAccountSchema>;
