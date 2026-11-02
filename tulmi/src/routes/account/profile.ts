/**
 * The person's profile, and Apple's one-time code after Sign in with Apple.
 */

import type { FastifyInstance } from "fastify";
import type { AppleSignIn } from "../../auth/appleSignIn.js";
import { resolveUser } from "../../auth/supabase.js";
import { updatePersonality } from "../../personality/store.js";
import { getProfile, type Profile, updateProfile } from "../../profile/store.js";
import { signedInVia } from "../bots/botsFirstRun.js";
import { unauthorized } from "../../http/helpers.js";

export interface ProfileRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  appleSignIn: AppleSignIn | null;
}

export function registerProfileRoutes(app: FastifyInstance, deps: ProfileRouteDeps): void {
  const { rateLimit: AUTHED_RL, appleSignIn } = deps;
  // --- Profile (REST): language + onboarding state ----------------------------

  app.get("/v1/profile", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    return reply.send(await getProfile(user));
  });

  // Sign in with Apple's one-time code (src/auth/appleSignIn.ts): the app hands it over just after an Apple sign-in, and the server trades it
  // at Apple for the token that ends the sign-in when the account is deleted. { kept } says whether a token is now kept; false while the key is
  // not set, for a sign-in that was not Apple's, or a code Apple would not trade. Never in the way of anything.
  app.post("/v1/auth/apple/code", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const code = (req.body as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || !code.trim() || code.length > 2000) {
      return reply.code(400).send({ code: "bad_request", message: "Apple's code is needed." });
    }
    if (!appleSignIn || signedInVia(user) !== "apple") return reply.send({ kept: false });
    const kept = await appleSignIn.keepCode(user.id, code.trim()).catch((err: unknown) => {
      req.log.warn({ err: (err as Error)?.message }, "apple code: could not keep the token");
      return false;
    });
    return reply.send({ kept });
  });

  app.put("/v1/profile", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as {
      dictionary?: unknown[];
      language?: string;
      onboarded?: boolean;
      full_name?: string;
      gender?: string;
    };
    const patch: Partial<Profile> = {};
    // A language code ("en", "zh-Hant-TW"), bounded: it is stored, and read back
    // as the locale and the prompt's fallback language on every request.
    if (typeof body.language === "string") patch.language = body.language.trim().slice(0, 35);
    if (typeof body.onboarded === "boolean") patch.onboarded = body.onboarded;
    // The name + gender card has been sending these since it shipped; until now
    // they were parsed off the body and dropped, so the card's answers lived only
    // in the phone's own storage and a reinstall asked again.
    if (typeof body.full_name === "string") {
      const name = body.full_name.trim().slice(0, 120);
      if (name) patch.fullName = name;
    }
    // The dictionary the editor sends. It was destructured nowhere and dropped
    // on the floor: the user got a success haptic, and their rows were gone on
    // the next screen load. It is stored on the PERSONALITY blob (jsonb, so no
    // migration) because that is where every other writing-behaviour setting
    // already lives and where the refine prompt reads from.
    if (Array.isArray(body.dictionary)) {
      const clean = body.dictionary
        .filter((r): r is { word: string; replacement: string } =>
          !!r && typeof r === "object" &&
          typeof (r as { word?: unknown }).word === "string" &&
          typeof (r as { replacement?: unknown }).replacement === "string")
        .map((r) => ({ word: r.word.trim().slice(0, 80), replacement: r.replacement.trim().slice(0, 200) }))
        .filter((r) => r.word && r.replacement)
        // Bounded, because every entry becomes prompt on every refine.
        .slice(0, 200);
      await updatePersonality(user, (existing) => ({ ...existing, dictionary: clean }));
    }
    if (body.gender === "female" || body.gender === "male" || body.gender === "other") {
      patch.gender = body.gender;
    }
    try {
      return reply.send(await updateProfile(user, patch));
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to save profile" });
    }
  });
}
