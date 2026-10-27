/** The Durable Object stubs the Worker reaches for: a job's room (its id is the job's id) and a person's devices (its id is the person's). */
import type { Env } from "./env.js";
import type { JobRoom } from "./jobRoom.js";

export type Room = DurableObjectStub<JobRoom>;
export const roomOf = (env: Pick<Env, "ROOMS">, jobId: string): Room => env.ROOMS.get(env.ROOMS.idFromName(jobId));
