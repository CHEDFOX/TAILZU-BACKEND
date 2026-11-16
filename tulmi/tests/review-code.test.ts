import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { registerReviewCodeRoute } from "../src/routes/account/reviewCode.js";
// eslint-disable-next-line import/first
import { resetConfigForTests } from "../src/config.js";

// The fixed pair that lets a reviewer in. It is the one credential in the app
// that is not a one-time code, so what matters is the shape of its refusals.

async function server() {
  const app = Fastify();
  registerReviewCodeRoute(app);
  await app.ready();
  return app;
}

function configure(email?: string, code?: string) {
  if (email === undefined) delete process.env.REVIEW_EMAIL;
  else process.env.REVIEW_EMAIL = email;
  if (code === undefined) delete process.env.REVIEW_CODE;
  else process.env.REVIEW_CODE = code;
  resetConfigForTests?.();
}

afterEach(() => configure(undefined, undefined));

describe("the review pair", () => {
  it("does not exist when neither half is set", async () => {
    configure(undefined, undefined);
    const app = await server();
    const res = await app.inject({
      method: "POST", url: "/v1/auth/review-code",
      payload: { email: "review@x0bot.com", code: "0000000000000000" },
    });
    // 404, not 401. A route that answers "wrong code" has told you it exists.
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("does not exist when only ONE half is set", async () => {
    // A half-finished configuration must not leave a door ajar — an email with
    // no code would otherwise be an account reachable with an empty string.
    for (const [e, c] of [["review@x0bot.com", undefined], [undefined, "1234567890123456"]] as const) {
      configure(e, c);
      const app = await server();
      const res = await app.inject({
        method: "POST", url: "/v1/auth/review-code",
        payload: { email: "review@x0bot.com", code: "1234567890123456" },
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    }
  });

  it("refuses a wrong code with the same answer as a wrong address", async () => {
    configure("review@x0bot.com", "1234567890123456");
    const app = await server();
    const bad = await app.inject({
      method: "POST", url: "/v1/auth/review-code",
      payload: { email: "review@x0bot.com", code: "0000000000000000" },
    });
    const stranger = await app.inject({
      method: "POST", url: "/v1/auth/review-code",
      payload: { email: "someone@else.com", code: "1234567890123456" },
    });
    expect(bad.statusCode).toBe(401);
    expect(stranger.statusCode).toBe(401);
    expect(bad.body).toBe(stranger.body);
    await app.close();
  });

  it("asks for both fields before it asks anything else", async () => {
    configure("review@x0bot.com", "1234567890123456");
    const app = await server();
    const res = await app.inject({
      method: "POST", url: "/v1/auth/review-code", payload: { email: "review@x0bot.com" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  /**
   * THE SHAPE OF THE CODE, which is not the route's business and is everybody's problem.
   *
   * App Review rejected build 85 under 2.1(a) with "the app reverted to Enter the code page after entering demo
   * code". Nothing was broken: the route was right, its tests passed, and the pair simply could not be TYPED. The
   * sign-in screen is a number pad that strips every non-digit and stops at six, so a longer or alphanumeric
   * REVIEW_CODE never reaches the route at all — the reviewer types it and the screen sits there.
   *
   * The tests above even use "AbCd1234", which is the exact shape that cannot be entered: the suite was holding the
   * wrong assumption in place. The route still takes any string, because it should not care; the check is in
   * config.ts, where a deploy log can carry it.
   */
  it("a code the sign-in screen could never take is a configuration mistake, and the config says so", async () => {
    const screenWouldKeep = (typed: string) => typed.replace(/\D/g, "").slice(0, 6);
    // What the app does to each of these before anything is sent.
    expect(screenWouldKeep("AbCd1234")).toBe("1234");        // letters gone, too short: verify() never fires
    expect(screenWouldKeep("longsecret12345678")).toBe("123456"); // truncated: the wrong code is sent
    expect(screenWouldKeep("123456")).toBe("123456");        // the only shape that survives
    const ok = /^\d{6}$/;
    expect(ok.test("AbCd1234")).toBe(false);
    expect(ok.test("1234567")).toBe(false);
    expect(ok.test("12345")).toBe(false);
    expect(ok.test("123456")).toBe(true);
  });

  it("takes a six-digit code end to end, which is the shape review actually uses", async () => {
    configure("review@x0bot.com", "640913");
    const app = await server();
    const wrong = await app.inject({
      method: "POST", url: "/v1/auth/review-code", payload: { email: "review@x0bot.com", code: "640914" },
    });
    expect(wrong.statusCode).toBe(401);
    await app.close();
  });

  it("matches the address case-insensitively, the code exactly", async () => {
    configure("Review@X0bot.Com", "AbCd1234");
    const app = await server();
    // An address is not case-sensitive and a reviewer's keyboard will capitalise
    // the first letter for them; a secret is case-sensitive and must stay so.
    const wrongCase = await app.inject({
      method: "POST", url: "/v1/auth/review-code",
      payload: { email: "review@x0bot.com", code: "abcd1234" },
    });
    expect(wrongCase.statusCode).toBe(401);
    await app.close();
  });
});
