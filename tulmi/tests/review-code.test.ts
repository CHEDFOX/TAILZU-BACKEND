import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { registerReviewCodeRoute } from "../src/routes/reviewCode.js";
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
      payload: { email: "review@tailzu.space", code: "0000000000000000" },
    });
    // 404, not 401. A route that answers "wrong code" has told you it exists.
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("does not exist when only ONE half is set", async () => {
    // A half-finished configuration must not leave a door ajar — an email with
    // no code would otherwise be an account reachable with an empty string.
    for (const [e, c] of [["review@tailzu.space", undefined], [undefined, "1234567890123456"]] as const) {
      configure(e, c);
      const app = await server();
      const res = await app.inject({
        method: "POST", url: "/v1/auth/review-code",
        payload: { email: "review@tailzu.space", code: "1234567890123456" },
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    }
  });

  it("refuses a wrong code with the same answer as a wrong address", async () => {
    configure("review@tailzu.space", "1234567890123456");
    const app = await server();
    const bad = await app.inject({
      method: "POST", url: "/v1/auth/review-code",
      payload: { email: "review@tailzu.space", code: "0000000000000000" },
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
    configure("review@tailzu.space", "1234567890123456");
    const app = await server();
    const res = await app.inject({
      method: "POST", url: "/v1/auth/review-code", payload: { email: "review@tailzu.space" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("matches the address case-insensitively, the code exactly", async () => {
    configure("Review@Tailzu.Space", "AbCd1234");
    const app = await server();
    // An address is not case-sensitive and a reviewer's keyboard will capitalise
    // the first letter for them; a secret is case-sensitive and must stay so.
    const wrongCase = await app.inject({
      method: "POST", url: "/v1/auth/review-code",
      payload: { email: "review@tailzu.space", code: "abcd1234" },
    });
    expect(wrongCase.statusCode).toBe(401);
    await app.close();
  });
});
