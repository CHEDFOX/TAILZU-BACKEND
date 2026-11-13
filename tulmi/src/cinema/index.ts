/**
 * THE CINEMA BOT, PUT TOGETHER: the service with the server's own parts behind each port (service.ts CinemaDeps).
 *
 *   models and media   OpenRouter's image, video and music APIs (openrouter.ts), the one key the server already has
 *   the director, eye  the model gateway (code/brain/gateway.ts callModel): the strong tier writes, the vision tier looks, the cheap tier reads
 *   voice-over         pipeline/tts.ts synthesize, in the film's voice
 *   ffmpeg             frames, the last frame, a voice-over's length, the cut (ffmpeg.ts)
 *   files              R2 (media/blob.ts); in memory when R2 is not set up (a dev server: a restart forgets them)
 *   money              usage/cost chargeUsd as the "cinema" bot; consent privacy/aiGate aiAllowedFor; pushes push/engine; screens live/writes
 *
 * Built once, by server.ts, when the bot is on (bots/builtin.ts cinemaOn).
 */
import { callModel } from "../code/brain/gateway.js";
import { getConfig } from "../config.js";
import { botTopic } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { blobStoreFromConfig, MemoryBlobStore } from "../media/blob.js";
import { synthesize } from "../pipeline/tts.js";
import { aiAllowedFor } from "../privacy/aiGate.js";
import { pushEngine } from "../push/index.js";
import { chargeUsd, ttsUsd } from "../usage/cost.js";
import { enforceQuota } from "../usage/metering.js";
import { cut, frames, seconds } from "./ffmpeg.js";
import { fetchVideo, liveModels, makeImage, makeMusic, startVideo, videoStatus } from "./openrouter.js";
import type { Think } from "./plan.js";
import { CinemaService, setCinemaService, type CinemaNotify } from "./service.js";
import { cinemaStore } from "./store.js";
import { CINEMA_SLUG } from "./types.js";

type EngineMsg = Parameters<NonNullable<ReturnType<typeof pushEngine>>["notify"]>[1];

const thinkAs = (userId: string): Think => async (o) => {
  const r = await callModel({
    tier: o.tier,
    userId,
    purpose: o.purpose,
    json: true,
    maxTokens: o.maxTokens,
    budget: { maxPaise: o.capPaise },
    messages: [{ role: "system", content: o.system }, { role: "user", content: o.user }],
  });
  return { json: r.json, text: r.text, usd: r.costUsd };
};

export function buildCinemaService(): CinemaService {
  const cfg = getConfig();
  const r2 = blobStoreFromConfig();
  if (!r2) console.warn("[cinema] R2 is not set up: films and pictures are kept in memory and a restart forgets them");
  const blobs = r2 ?? new MemoryBlobStore();
  const notify: CinemaNotify = async (userId, msg) => { await pushEngine()?.notify(userId, msg as unknown as EngineMsg); };
  const svc = new CinemaService({
    store: cinemaStore(),
    blobs,
    think: thinkAs,
    models: async () => {
      const l = await liveModels();
      return { video: l.video, image: l.image };
    },
    media: {
      image: makeImage,
      startVideo,
      videoStatus,
      fetchVideo,
      music: makeMusic,
      tts: async (text, voice) => {
        const out = await synthesize({ text, voice, format: "mp3" });
        return { audio: out.audio, usd: out.usd ?? ttsUsd(text.length) };
      },
      frames,
      seconds: (b) => seconds(b),
      cut,
    },
    charge: (userId, usd) => chargeUsd(userId, usd, CINEMA_SLUG),
    aiAllowed: aiAllowedFor,
    allowance: (userId) => enforceQuota({ id: userId }),
    notify,
    live: (userId) => livePublish(userId, [botTopic(CINEMA_SLUG)]),
    fx: cfg.CODE_USD_INR,
    filmMaxPaise: cfg.CINEMA_FILM_MAX_PAISE,
    dailyPaise: cfg.CINEMA_DAILY_PAISE,
    log: (line) => console.warn(line),
  });
  setCinemaService(svc);
  return svc;
}
