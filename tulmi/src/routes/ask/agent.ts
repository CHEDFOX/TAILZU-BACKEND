/**
 * POST /v1/agent: Ask, the on-screen agent, one step at a time.
 *
 * The device owns the run: it reads the front window into a list of elements
 * with ids, posts one step at a time, and acts on what comes back. Each step
 * answers with NDJSON, one event per line, written the moment it is known, so
 * the guide points and talks while the planner is still writing. See
 * src/agent for the planner; this is the door to it.
 *
 * Before the stream starts, a bad request is an ordinary JSON 400/401/413/429.
 * After it starts there is no status left to set, so everything (a refusal,
 * a failed model, a thrown error) ends the stream as one terminal event, and
 * the stream always ends.
 *
 * What is written for the user (WRITE, REWRITE, a selection rewrite) counts
 * its words, like an edit; the planner's own words do not, like an answer.
 * No step writes a History entry: a run is a handful of clicks, not writing.
 *
 * A multipart step may carry one picture as well, an `image` part, which
 * sends it down the picture path. It is read up to AGENT_IMAGE_MAX_BYTES and
 * no further: past that the rest is read and thrown away, so a huge part
 * costs a refusal and not the memory to hold it. The picture is never logged,
 * and is gone with the request.
 */

import type { FastifyInstance } from "fastify";
import type { AudioFormat } from "../../../../shared/types/api.js";
import { planStream } from "../../agent/llm.js";
import { type AgentImage, type Refusal, readPicture, audioFormatOf, readStepRequest, EventSink } from "../../agent/protocol.js";
import { type StepResult, runStep } from "../../agent/run.js";
import { resolveUser } from "../../auth/supabase.js";
import type { AppConfig } from "../../config.js";
import type { Connectors } from "../../connectors/index.js";
import { nicknameOf, ASSISTANT_NAME, NAME_HEARD, vocabularyWithNames } from "../../experience/assistantName.js";
import { getPersonality } from "../../personality/store.js";
import { assist, editSelection } from "../../pipeline/cleanup.js";
import { fieldKindOf, cleanLabel } from "../../pipeline/field.js";
import { estimateDurationSeconds, transcribe } from "../../pipeline/stt.js";
import { effectiveLanguage } from "../../profile/language.js";
import { getProfile } from "../../profile/store.js";
import type { RunLedger } from "../../runs/ledger.js";
import { enforceQuota, recordPicture, recordUsage } from "../../usage/metering.js";
import { unauthorized } from "../../http/helpers.js";

export interface AgentRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  cfg: AppConfig;
  ledger: RunLedger;
  connectors: Connectors | null;
}

export function registerAgentRoutes(app: FastifyInstance, deps: AgentRouteDeps): void {
  const { rateLimit: AGENT_RL, cfg, ledger, connectors } = deps;
  /** A spoken request, or an answer to a question. Two minutes is far past
   *  either, and well inside what a recogniser accepts. */
  const AGENT_AUDIO_MAX_SECONDS = 120;

  /** A file part, read to its end, kept only while it is within `max` bytes:
   *  null when it went past. */
  async function readUpTo(file: AsyncIterable<Buffer>, max: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file) {
      size += chunk.length;
      if (size <= max) chunks.push(chunk);
      else chunks.length = 0;
    }
    return size <= max ? Buffer.concat(chunks) : null;
  }

  app.post("/v1/agent", { config: AGENT_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    let raw: unknown;
    let audio: Buffer | null = null;
    let format: AudioFormat = "webm";
    let image: AgentImage | null = null;
    let unreadable = false;
    let refused: Refusal | null = null;
    if (req.isMultipart()) {
      // Every part is read to the end, even after a bad one: a multipart stream
      // left half-read never finishes the request. Two files at most, the
      // recording and the picture; a third is the plugin's 413.
      for await (const part of req.parts({ limits: { files: 2 } })) {
        if (part.type === "file") {
          if (part.fieldname === "image") {
            const data = await readUpTo(part.file, cfg.AGENT_IMAGE_MAX_BYTES);
            const pic = readPicture(part.mimetype, data, cfg.AGENT_IMAGE_MAX_BYTES);
            if (image) refused ??= { status: 400, code: "bad_request", message: "One picture per step" };
            else if ("refusal" in pic) refused ??= pic.refusal;
            else image = pic.image;
            continue;
          }
          const buf = await part.toBuffer();
          if (part.fieldname === "audio") {
            if (audio) refused ??= { status: 400, code: "bad_request", message: "One recording per step" };
            audio = buf;
            format = audioFormatOf(part.filename, part.mimetype);
          }
        } else if (part.fieldname === "request") {
          try { raw = JSON.parse(String(part.value)); } catch { unreadable = true; }
        }
      }
    } else {
      raw = req.body;
    }
    if (unreadable) return reply.code(400).send({ code: "bad_request", message: "'request' is not JSON" });
    if (refused) return reply.code(refused.status).send({ code: refused.code, message: refused.message });

    const read = readStepRequest(
      raw,
      { maxElements: cfg.AGENT_MAX_ELEMENTS, screenMaxChars: cfg.AGENT_SCREEN_MAX_CHARS },
      !!audio,
      !!image,
    );
    if ("refusal" in read) return reply.code(read.refusal.status).send({ code: read.refusal.code, message: read.refusal.message });
    const step = read.req;
    if (audio && estimateDurationSeconds(audio, format) > AGENT_AUDIO_MAX_SECONDS) {
      return reply.code(413).send({ code: "audio_too_long", message: "That recording is too long for Ask." });
    }

    // A recording is a question spoken to Ask, held to Ask's own seconds too,
    // and a picture to the day's pictures.
    const quota = await enforceQuota(user, { agentAudio: !!audio, picture: !!image });
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    // The run ledger's eye on this step: how it ends (and the receipt that
    // says so, before a terminal that ends the run), what the apps did, and
    // each planner call. Written once the stream has closed.
    const watch = ledger.begin({
      userId: user.id, runId: step.runId, surface: "desktop", platform: step.platform, step: step.step,
      ...(step.utterance ? { said: step.utterance } : {}), ...(step.language ? { language: step.language } : {}),
    });

    // From here the reply is ours to write by hand.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    // The device hanging up (Esc, a new tap) stops the model mid-answer, so its
    // tokens are not paid for. A response this side finished is not a hang-up:
    // the planner's last chunk, with its token counts, may still be on its way.
    const gone = new AbortController();
    // The desktop lets go as soon as it has read the terminal event, often
    // before this side has finished; for the ledger, only a close before the
    // terminal event is the person stopping the run.
    let hungUp = false;
    res.on("close", () => {
      if (res.writableFinished) return;
      if (!sink.ended) hungUp = true;
      gone.abort();
    });
    const sink = new EventSink((line) => {
      if (!res.writableEnded && !res.destroyed) res.write(line);
    }, watch.sink);

    const t0 = Date.now();
    let result: StepResult | undefined;
    try {
      const personality = await getPersonality(user);
      const lang = await effectiveLanguage(user, step.language, personality);
      const writer = {
        targetApp: step.app,
        fieldKind: fieldKindOf(step.screen.field?.kind),
        fieldLabel: cleanLabel(step.screen.field?.label, 60),
        language: lang,
        personality,
        tone: personality.activeTone,
        variables: { email: user.email, phone: user.phone },
      };
      const nick = nicknameOf(personality);
      result = await runStep(
        {
          req: step, maxSteps: cfg.AGENT_MAX_STEPS, names: [ASSISTANT_NAME, ...NAME_HEARD, "Blip", ...(nick ? [nick] : [])],
          ...(image ? { image } : {}),
        },
        {
          hear: audio
            ? async () => {
                const stt = await transcribe({
                  audio: audio!, format, language: lang,
                  vocabulary: vocabularyWithNames(personality),
                  portraitCore: personality.stylePortrait?.core,
                  portraitWords: personality.stylePortrait?.words,
                  languages: personality.languages?.map(String),
                });
                return { text: stt.text, seconds: stt.durationSeconds || estimateDurationSeconds(audio!, format) };
              }
            : undefined,
          write: (instruction, context) => assist(instruction, { ...writer, context }),
          rewrite: (selection, instruction) => editSelection(selection, instruction, writer, { spoken: true }),
          plan: (system, userMessage, signal, picture) => planStream(system, userMessage, {
            signal,
            picture,
            // One line per model call: which model, how soon it started, what it
            // cost, and whether a picture went with it. Never the prompt, the
            // picture or the answer. The ledger keeps the same, per run.
            log: (call) => {
              req.log.info({ agent: { runId: step.runId, step: step.step, ...call } }, "agent model call");
              watch.call(call);
            },
          }),
          signal: gone.signal,
          ...(connectors ? { connectors: watch.watch(connectors.runtimeFor(user.id, () => getProfile(user).then((p) => p?.language)), connectors.hub) } : {}),
        },
        sink,
      );
    } catch (err) {
      req.log.error({ err, runId: step.runId, step: step.step }, "agent step failed");
      sink.emit({ t: "error", code: "internal", message: "Something went wrong. Try again in a moment." });
    } finally {
      if (!sink.ended) sink.emit({ t: "error", code: "internal", message: "Something went wrong. Try again in a moment." });
      res.end();
    }

    // After the stream has closed: the device already has its answer, and a
    // slow metering or ledger write must not hold it open.
    void watch.end(result, { hungUp });
    if (result && result.path !== "refused") {
      if (result.path === "picture") recordPicture(user);
      await recordUsage({
        user,
        source: "agent",
        audioSeconds: result.audioSeconds,
        words: result.words,
        model: result.model ?? (result.path === "selection" ? cfg.CLEANUP_MODEL : "rules"),
      }).catch((err) => req.log.error({ err }, "agent usage not recorded"));
    }
    // One line per step, with no screen text and none of what was said in it.
    req.log.info({
      agent: {
        runId: step.runId, step: step.step, platform: step.platform,
        path: result?.path ?? "failed", mode: result?.mode, model: result?.model, ending: sink.ending,
        ...(watch.receipt ? { outcome: watch.receipt.outcome, reason: watch.receipt.reason } : {}),
        events: sink.count, elements: step.screen.elements.length, words: result?.words ?? 0,
        audioSeconds: result?.audioSeconds ?? 0, ms: Date.now() - t0,
        ...(image ? { picture: true, pictureBytes: image.data.length, region: step.picture?.region } : {}),
        ...(result?.deep ? { deep: true } : {}),
        // The marks drawn, and the DRAW lines dropped (unreadable, at an id not
        // on this screen, at a picture place with no picture, past the cap): a
        // model that keeps missing is seen here, and nowhere else.
        ...(result?.draws ? { draws: result.draws } : {}),
        ...(result?.drawsDropped ? { drawsDropped: result.drawsDropped } : {}),
      },
    }, "agent step");
  });
}
