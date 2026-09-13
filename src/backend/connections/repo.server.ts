import { secretStorage } from "~/backend/secrets/storage.server";
import { createConnectionRepository } from "./repo";

export const connectionRepository = createConnectionRepository(secretStorage);
