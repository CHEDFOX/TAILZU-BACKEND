/**
 * A MESSAGE MADE COMPLETE (src/front/complete.ts): a follow-up is looked up as what the person meant; a message that stands alone costs nothing.
 */
import { describe, expect, it } from "vitest";
import { completeMessage } from "../src/front/complete.js";

function model(reply: string | Error) {
  const sent: Array<{ tier: string; purpose: string; user: string }> = [];
  return {
    sent,
    m: {
      userId: "alice",
      call: (async (input: { tier: string; purpose: string; messages: Array<{ role: string; content: string }> }) => {
        sent.push({ tier: input.tier, purpose: input.purpose, user: String(input.messages.at(-1)?.content) });
        if (reply instanceof Error) throw reply;
        return { text: reply, paise: 0.4, model: "tiny" };
      }) as never,
    },
  };
}

describe("completing a message", () => {
  it("leaves a message that stands alone as it is, and asks no model", async () => {
    const f = model("never");
    expect(await completeMessage(f.m, { message: "where is the login route defined in the routes folder?", lastQuestion: "what does slug do?" }))
      .toEqual({ text: "where is the login route defined in the routes folder?", via: "as_is", paise: 0 });
    expect(await completeMessage(f.m, { message: "and the logout?" })).toMatchObject({ via: "as_is" });
    expect(f.sent).toEqual([]);
  });

  it("asks the tiny model once for a follow-up, with the last question, the start of the last answer and the message as data", async () => {
    const f = model("Where is the logout checked?\nextra line");
    const out = await completeMessage(f.m, { message: "and the logout?", lastQuestion: "where is the login checked?", lastAnswer: `In requireUser. ${"x".repeat(2000)}` });
    expect(out).toEqual({ text: "Where is the logout checked?", via: "model", paise: 0.4 });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ tier: "tiny", purpose: "front.complete" });
    expect(f.sent[0]!.user).toContain("<last_question>\nwhere is the login checked?\n</last_question>");
    expect(f.sent[0]!.user).toContain("<message>\nand the logout?\n</message>");
    expect(f.sent[0]!.user.length).toBeLessThan(1000);
  });

  it("completes a longer message the front door already knows is a follow-up", async () => {
    const f = model("Where in the checkout code is the cart total tested?");
    expect(await completeMessage(f.m, { message: "ok but where exactly is that one tested in the code", lastQuestion: "how does checkout total the cart?", followUp: true }))
      .toMatchObject({ via: "model" });
  });

  it("falls back to the last question in front of the message when the model fails or says nothing usable", async () => {
    for (const reply of [new Error("down"), "", "x".repeat(500)]) {
      const f = model(reply);
      expect(await completeMessage(f.m, { message: "and the logout?", lastQuestion: "where is the login checked?" }))
        .toMatchObject({ text: "where is the login checked?. and the logout?", via: "joined" });
    }
  });
});
