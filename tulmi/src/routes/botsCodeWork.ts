/**
 * Bots app · codeWork area (screens/codeWork.ts): the endpoints its screens need beyond the existing routes. None: the live job, its
 * chat, the team, the design, the preview, attaching, done and failed all run on routes/codeJobs.ts, routes/artifacts.ts,
 * routes/files.ts and the front door (POST /v1/ask with projectId and threadId).
 */
import type { FastifyInstance } from "fastify";
import type { BotsAreaDeps } from "./botsArea.js";

export function registerBotsCodeWorkRoutes(_app: FastifyInstance, _deps: BotsAreaDeps): void {}
