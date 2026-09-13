import { createSecretStorage } from "~/backend/secrets/storage";
import { loadCredentialEncryptionKey } from "./key.server";

// Persist or load the installation key before the server accepts credentials.
export const secretStorage = createSecretStorage(loadCredentialEncryptionKey());
