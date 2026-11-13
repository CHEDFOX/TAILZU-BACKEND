/**
 * The native keyboards: GET /v1/keyboard/config and POST /v1/keyboard/telemetry.
 */

import type { FastifyInstance } from "fastify";
import type { Personality } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import { isEntitled } from "../../billing/entitlements.js";
import type { AppConfig } from "../../config.js";
import { withControl } from "../../control/index.js";
import { localizeKeyboardLabels } from "../../experience/i18n.js";
import { type KeyboardPlatform, buildKeyboardConfig } from "../../experience/keyboard/config.js";
import { withKeySkin } from "../../experience/keyboard/skin.js";
import { KEYBOARD_BAD_HEADER, KEYBOARD_CAN_HEADER } from "../../../../shared/types/keyboardFace.js";
import { activeRollouts, bucketFor } from "../../experience/rollout.js";
import { withKeybotKeyboard } from "../../keybot/keyboard.js";
import { type KeybotPrefs, getPrefs } from "../../keybot/prefs.js";
import { getPersonality } from "../../personality/store.js";
import { getProfile } from "../../profile/store.js";
import { allowanceFor } from "../../usage/metering.js";
import { recordKeyboardTelemetry } from "../../usage/telemetry.js";
import { gzipLargeJson, noStoreSdui, unauthorized } from "../../http/helpers.js";

export interface KeyboardRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  cfg: AppConfig;
}

export function registerKeyboardRoutes(app: FastifyInstance, deps: KeyboardRouteDeps): void {
  const { rateLimit: AUTHED_RL, cfg } = deps;
  // --- Keyboard config (server-driven keyboard; cached by the native shell) ----

  /**
   * Which keyboard is asking, from the one signal both send without being told
   * to: the HTTP client's default User-Agent. The Android keyboard talks through
   * OkHttp ("okhttp/…"); the iOS extension through URLSession, which names the
   * bundle and CFNetwork. Neither client asserts a platform, so neither can lie
   * about it — and an unknown agent is treated as iOS, the platform whose config
   * is safe to serve to anyone.
   */
  function keyboardPlatform(userAgent: unknown): KeyboardPlatform {
    const ua = String(userAgent ?? "").toLowerCase();
    return /okhttp|dalvik|android/.test(ua) ? "android" : "ios";
  }

  app.get("/v1/keyboard/config", { config: AUTHED_RL, onSend: gzipLargeJson }, async (req, reply) => {
    // Personality is per-user — the keyboard uses it to render the quick-swap
    // chip row (pinned presets) + honor the active preset's default tone.
    // Missing/failed auth just returns the config without pins; the keyboard
    // still works, it just shows the built-in tone cycle instead.
    let personality: Personality | undefined;
    // Also the rollout key: a user's experiment slice is derived from their id,
    // so it stays put across requests instead of re-rolling mid-session.
    let userId: string | undefined;
    /**
     * What is left to spend, so the mic can say so BEFORE the user speaks.
     *
     * The 429 on the transcribe route is the authority and stays the backstop —
     * a config is cached and can be minutes stale. But being refused after
     * saying a sentence is a worse way to learn this than being told when you
     * reach for the button, so the keyboard is given the number too.
     */
    let quota: { remaining: number; total: number; entitled: boolean } | undefined;
    /** What they chose on Keylessbord's Keyboard page (look, haptics, key height…), laid over the config below. */
    let keybot: KeybotPrefs["keyboard"];
    /** The language the app is in, so the keyboard's words are in it too (localizeKeyboardLabels). */
    let language: string | undefined;
    try {
      const user = await resolveUser(req.headers["authorization"]);
      if (user) {
        userId = user.id;
        const [p, entitled, allowance, prefs, prof] = await Promise.all([
          getPersonality(user),
          isEntitled(user).catch(() => true),          // unknown → let them through
          allowanceFor(user).catch(() => null),
          getPrefs(user).catch(() => ({} as KeybotPrefs)),
          getProfile(user).catch(() => null),
        ]);
        personality = p;
        keybot = prefs.keyboard;
        language = prof?.language;
        if (allowance) {
          quota = { remaining: allowance.remaining, total: allowance.total, entitled: entitled || cfg.FREE_FOR_ALL };
        }
      }
    } catch { /* keyboard should never fail on personality lookup */ }
    // Cache-Control: no-store — keyboard config carries per-user
    // `kb.personality.pinned` / activeId / activeTone. Any caching layer
    // (nginx, CDN) that indexed the response by URL alone could leak these
    // across users. Same policy as /v1/app/bootstrap and /v1/app/screen.
    noStoreSdui(reply);
    // Which binary is asking: iOS "K37" → 37, Android "A2" → 2. Older builds
    // send nothing. The K-number gates iOS-only features (kbBuild); either
    // number lets a control rule target a build range on its own platform.
    const stamp = String(req.headers["x-tulmi-keyboard-build"] ?? "").match(/^([KA])(\d{1,5})$/i);
    const kbPlatform = keyboardPlatform(req.headers["user-agent"]);
    // WHICH KEYBOARD IS ON THE PHONE, every time one opens. The telemetry
    // upload says it too, but only every half hour; this says it the moment the
    // keyboard asks for its settings — and if no line appears when a keyboard
    // opens, that keyboard is not reaching the server at all.
    //   docker compose logs backend | grep "keyboard config"
    req.log.info(
      { build: stamp ? stamp[0]!.toUpperCase() : "none", platform: kbPlatform, signedIn: !!userId },
      "keyboard config",
    );
    const isIosStamp = !!stamp && stamp[1]!.toUpperCase() === "K";
    // WHAT THIS KEYBOARD CAN DRAW, as it says so itself: "X-Tulmi-Keyboard-Can: KeySkin1". The skin expansion gates on this list
    // instead of doing arithmetic on build stamps, so a name is a promise about the BINARY and nothing else. The bad header is the
    // other half: the crash guard struck on that skin, so this device is sent the unskinned tree until it stops saying so.
    const can = new Set(String(req.headers[KEYBOARD_CAN_HEADER.toLowerCase()] ?? "").split(/[,\s]+/).filter(Boolean).slice(0, 8));
    const badSkin = String(req.headers[KEYBOARD_BAD_HEADER.toLowerCase()] ?? "").trim().slice(0, 40) || undefined;
    // Keylessbord's keyboard choices go over the built config (nothing chosen → the same config, byte for byte), then the person's
    // skin pick is expanded into the tree, and the control rules go over both, so the console still has the last word.
    const kbConfig = withKeySkin(withKeybotKeyboard(buildKeyboardConfig(personality, userId, {
      platform: kbPlatform,
      quota,
      ...(isIosStamp ? { kbBuild: Number(stamp![2]) } : {}),
    }), keybot, personality), {
      can, ...(keybot?.skin ? { skin: keybot.skin } : {}), ...(badSkin ? { bad: badSkin } : {}),
      // The keyboard's own testers' stage: while KEYBOARD_SKINS_USERS names anyone, only those accounts get a skinned tree.
      ...(userId ? { userId } : {}),
    });
    return reply.send(await localizeKeyboardLabels(withControl(req, reply, kbConfig, {
      surface: "keyboard",
      platform: kbPlatform,
      formFactor: "phone",
      ...(stamp ? { build: Number(stamp[2]) } : {}),
      userId,
      signedIn: !!userId,
    }), language));
  });

  // --- Keyboard telemetry ------------------------------------------------------
  //
  // Diagnostic COUNTERS from the keyboard. This is the missing half of remote
  // control: 130+ behaviors are tunable and rollout-scoped, but without counters
  // every experiment is judged by feel.
  //
  // PRIVACY: a keyboard extension sees everything the user types, so this
  // endpoint is built to make leaking content impossible rather than unlikely.
  // Counter NAMES are allowlisted and values must be finite numbers — a string
  // is rejected outright, so there is no shape in which text could arrive, even
  // if a future client tried to send it.
  const TELEMETRY_COUNTERS = new Set([
    "keystrokes",
    // The touch path, counted (K39+): so a dropped keystroke is a number.
    "planeTouches",
    "planeMissed",
    "liftRescued",
    "liftRolled",
    "cancelRescued",
    "trayRetracted",
    "remounts",
    "keyMs",
    "slowKeys",
    // The keystroke budget and what a rebuild costs (iOS): over a 60 Hz frame
    // (16 ms), and the key tree's build time summed, with how many missed it.
    "keysOverFrame",
    "remountMs",
    "slowRemounts",
    // How close the iOS extension runs to its memory ceiling: one sample per
    // open, and how many of those were at or over each band.
    "memSampled",
    "memOver30MB",
    "memOver40MB",
    "memOver50MB",
    "autocorrectApplied",
    "autocorrectReverted",
    "suggestionAccepted",
    "confusableOffered",
    "confusableAccepted",
    "swipeCommitted",
    "swipeAbandoned",
    "touchesCancelledRescued",
    "accentTrayOpened",
    "trackpadUsed",
    "micTaps",
    "dictationCommitted",
    "refineRequested",
    "refineFailed",
    "toneChanged",
    "voiceChanged",
    "memoryWarnings",
    "coldStarts",
  ]);
  /** Cap a single counter so a buggy or hostile client can't skew aggregates. */
  const TELEMETRY_MAX = 1_000_000;

  app.post("/v1/keyboard/telemetry", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as {
      build?: unknown;
      appVersion?: unknown;
      platform?: unknown;
      counters?: unknown;
      windowMs?: unknown;
    };

    // Keep only known counters with finite numeric values.
    const counters: Record<string, number> = {};
    const raw = (body.counters ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (!TELEMETRY_COUNTERS.has(k)) continue;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      counters[k] = Math.min(Math.floor(n), TELEMETRY_MAX);
    }
    // Nothing recognizable — accept quietly so a client on a newer/older counter
    // set never sees an error it would have to handle.
    if (!Object.keys(counters).length) return reply.send({ ok: true, recorded: 0 });

    // Which rollout slices this user is in, so a cohort can be compared against
    // the baseline. Derived server-side from the same salted hash the flags use
    // — the client never asserts its own bucket.
    const rules = activeRollouts();
    const buckets: Record<string, number> = {};
    for (const r of rules) buckets[r.flag] = bucketFor(user.id, r.flag);

    const short = (v: unknown, max: number) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

    // Numbers only, by construction — safe to log, and the quickest way to read
    // a phone's touch path: `docker compose logs backend | grep "keyboard telemetry"`.
    req.log.info({ build: short(body.build, 16), counters }, "keyboard telemetry");
    try {
      await recordKeyboardTelemetry(user, {
        build: short(body.build, 16),
        appVersion: short(body.appVersion, 32),
        platform: body.platform === "android" ? "android" : "ios",
        buckets,
        counters,
        windowMs: Math.max(0, Math.min(Number(body.windowMs) || 0, 7 * 24 * 60 * 60 * 1000)),
      });
    } catch (err) {
      // Telemetry must never surface as a user-visible failure — the keyboard
      // fires this in the background while someone is typing.
      req.log.error(err);
    }
    return reply.send({ ok: true, recorded: Object.keys(counters).length });
  });
}
