/**
 * The person's style profile: read and save it, haptics, tones, pinned voices, and learning from a sample.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PersonalityResponse, Personality } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import { PERSONALITY_PRESETS } from "../../experience/personalityPresets.js";
import { getPersonality, updatePersonality, upsertPresetTone } from "../../personality/store.js";
import { inferStyle } from "../../pipeline/cleanup.js";
import { enforceQuota } from "../../usage/metering.js";
import { unauthorized } from "../../http/helpers.js";

export interface PersonalityRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  personalityProblem: (p: Personality | undefined) => { status: 400 | 413; message: string } | null;
  tooLong: (text: string | undefined) => string | null;
}

export function registerPersonalityRoutes(app: FastifyInstance, deps: PersonalityRouteDeps): void {
  const { rateLimit: AUTHED_RL, personalityProblem, tooLong } = deps;
  // --- Personality (REST): read / save the user's style profile ---------------

  app.get("/v1/personality", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const personality = await getPersonality(user);
    const res: PersonalityResponse = { personality };
    return reply.send(res);
  });

  app.put("/v1/personality", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const personality = (req.body ?? {}) as Personality;
    const bad = personalityProblem(personality);
    if (bad) return reply.code(bad.status).send({ code: "bad_request", message: bad.message });
    // activePresetId must reference a real preset — built-in or one of the
    // user's custom tones — or it silently poisons the keyboard config
    // (kb.personality.activeId) and the voices screen's active highlight.
    if (personality.activePresetId !== undefined && personality.activePresetId !== null) {
      const id = String(personality.activePresetId);
      const existing = await getPersonality(user);
      const known =
        PERSONALITY_PRESETS.some((p) => p.id === id) ||
        Object.keys(existing?.presetOverrides ?? {}).includes(id);
      if (!known) {
        return reply.code(400).send({ code: "bad_request", message: `unknown presetId: ${id}` });
      }
    }
    try {
      // Merge the partial update into the existing profile so a PUT with just
      // { activePresetId } doesn't blow away the user's vocabulary, sign-off,
      // and pinned list. Under the per-user lock (updatePersonality) so this
      // shallow-merge can't clobber a concurrent tone / vocab / pin write.
      // What has been reported to Meta is the server's record, not a setting:
      // a client that sends it back (or sends it empty) changes nothing. Nor is the AI permission set here: only its own route
      // (privacy/aiConsent.ts), when the person taps Agree or switches it off.
      const { adsReported: _serverOwned, aiConsentAt: _a, aiConsentVersion: _v, aiConsentWithdrawnAt: _w, ...theirs } = personality;
      const merged = await updatePersonality(user, (existing) => ({ ...existing, ...theirs }));
      const res: PersonalityResponse = { personality: merged };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to save personality" });
    }
  });

  // Toggle keyboard haptics — one key, or the master switch.
  //
  // A dedicated route rather than the PUT above because this is a SET membership
  // change: the PUT shallow-merges, so a client would have to send the whole
  // array back, and two quick taps would race with each other and drop one. This
  // read-modify-writes under the same per-user lock, so every tap lands.
  const hapticsToggleSchema = z.object({
    key: z.string().min(1).max(24).optional(),
    all: z.boolean().optional(),
    /** With all:false, the keys picked by hand go too (the You tab's switch). */
    clear: z.boolean().optional(),
  });

  app.post("/v1/personality/haptics", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const parsed = hapticsToggleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: "key or all required" });
    }
    const { key, all, clear } = parsed.data;
    if (key === undefined && all === undefined) {
      return reply.code(400).send({ code: "bad_request", message: "key or all required" });
    }
    try {
      const merged = await updatePersonality(user, (existing) => {
        const next = { ...existing };
        if (all !== undefined) next.hapticsAll = all;
        // "I know" on the You tab's switch: every key off, the hand-picked ones too.
        if (clear === true) next.hapticKeys = [];
        if (key !== undefined) {
          const id = key.toLowerCase();
          const cur = new Set(existing?.hapticKeys ?? []);
          if (cur.has(id)) cur.delete(id); else cur.add(id);
          // Bounded: the picker only ever shows the keys on three layouts, so a
          // list longer than this is a client bug, not a user preference.
          next.hapticKeys = Array.from(cur).slice(0, 128);
        }
        return next;
      });
      const res: PersonalityResponse = { personality: merged };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to save haptics" });
    }
  });

  // Create / edit / delete a single tone (personality preset) — the two-field
  // tone editor on the Voice screen. Read-modify-writes ONE presetOverrides entry
  // under the per-user lock so it can't clobber the user's other tones (the PUT
  // above shallow-merges the whole map). id present = edit; absent = new custom
  // tone; remove=true = delete/reset. On save the tone becomes the active voice.
  const toneUpsertSchema = z.object({
    id: z.string().max(120).optional(),
    name: z.string().max(80).optional(),
    promptStyle: z.string().max(2000).optional(),
    remove: z.boolean().optional(),
    // "New voice for keyboard" path: also pin the saved tone to the keyboard
    // set (same 6-cap as /v1/personality/pin), atomically with the upsert.
    pin: z.boolean().optional(),
  });
  app.post("/v1/personality/tone", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const parsed = toneUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: "Invalid tone payload" });
    }
    const { id, name, promptStyle, remove, pin } = parsed.data;
    if (!remove && !(name?.trim() || promptStyle?.trim())) {
      return reply.code(400).send({ code: "bad_request", message: "A tone needs a name or a prompt" });
    }
    try {
      const { personality, toneId } = await upsertPresetTone(user, { id, name, promptStyle, remove, pin });
      const res: PersonalityResponse = { personality };
      return reply.send({ ...res, toneId });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to save tone" });
    }
  });

  // Toggle a preset on/off in the user's keyboard pin list. Idempotent per
  // action (POST body decides), enforces the 6-item ceiling. Kept separate
  // from PUT /v1/personality so the client doesn't have to round-trip the
  // whole profile just to star an item.
  const MAX_PINNED = 6;
  app.post("/v1/personality/pin", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as { presetId?: string; pinned?: boolean };
    // Bounded like every preset id (tone ids are ≤ 120): it is stored, and
    // sent back in every keyboard config.
    const presetId = String(body.presetId ?? "").trim().slice(0, 120);
    if (!presetId) return reply.code(400).send({ code: "bad_request", message: "Missing presetId" });
    try {
      // Read-modify-write under the per-user lock so a concurrent PUT / tone /
      // vocab write can't clobber the pin change (and vice-versa).
      let next: string[] = [];
      const merged = await updatePersonality(user, (existing) => {
        const current = Array.isArray(existing.pinnedPresetIds) ? [...existing.pinnedPresetIds] : [];
        // Toggle when `pinned` is omitted (star icon UX). Otherwise honor the
        // explicit flag — lets a settings screen force-add or force-remove.
        const explicit = typeof body.pinned === "boolean" ? body.pinned : !current.includes(presetId);
        if (explicit) {
          // Add — cap at MAX_PINNED, evicting the oldest to make room. Matches
          // the "star already has 6 → drop the first" UX shipping apps use.
          if (current.includes(presetId)) next = current;
          else next = [...current, presetId].slice(-MAX_PINNED);
        } else {
          next = current.filter((id) => id !== presetId);
        }
        return { ...existing, pinnedPresetIds: next };
      });
      return reply.send({ personality: merged, pinnedPresetIds: next });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to update pin" });
    }
  });

  // Learn a style profile from a sample of the user's own writing, merge it into
  // their saved personality, and return the result.
  app.post("/v1/personality/learn", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as { sample?: string };
    if (!body.sample || !body.sample.trim()) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'sample'" });
    }
    const over = tooLong(body.sample);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    try {
      const inferred = await inferStyle(body.sample);
      // Merge under the per-user lock so the inferred style can't clobber a
      // concurrent tone / pin / vocab write.
      const merged = await updatePersonality(user, (existing) => ({ ...existing, ...inferred }));
      const res: PersonalityResponse = { personality: merged };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to learn style" });
    }
  });
}
