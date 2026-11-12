/**
 * THE MEETING BOT'S WORDS (src/meet/words.ts): which links are meetings (Google Meet, Zoom, Teams, Webex, and nothing else, not even a
 * meeting link inside another site's address); when a line someone said in the call is said to the bot (its name at the start, set off,
 * after a greeting or followed by a question; at the end of a question), and not when they talk about it; and the two things it does at
 * once when told: stop talking, leave.
 */
import { describe, expect, it } from "vitest";
import { addressed, commandOf, meetingOf, wakeNames } from "../src/meet/words.js";

describe("meeting links", () => {
  it("finds the meeting in an invite, cleaned, with its platform", () => {
    expect(meetingOf("Join: https://meet.google.com/abc-defg-hij?authuser=0")).toEqual({ url: "https://meet.google.com/abc-defg-hij?authuser=0", platform: "google_meet" });
    expect(meetingOf("Zoom https://us02web.zoom.us/j/1234567890?pwd=xyz.")).toEqual({ url: "https://us02web.zoom.us/j/1234567890?pwd=xyz", platform: "zoom" });
    expect(meetingOf("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0")?.platform).toBe("teams");
    expect(meetingOf("https://acme.webex.com/meet/asha")?.platform).toBe("webex");
    expect(meetingOf("meet.google.com/abc-defg-hij")).toEqual({ url: "https://meet.google.com/abc-defg-hij", platform: "google_meet" });
  });

  it("takes nothing else for a meeting", () => {
    expect(meetingOf("https://zoom.us/pricing")).toBeNull();
    expect(meetingOf("https://meet.google.com/")).toBeNull();
    expect(meetingOf("https://evil.com/meet.google.com/abc-defg-hij")).toBeNull();
    expect(meetingOf("https://meet.google.com.evil.com/abc-defg-hij")).toBeNull();
    expect(meetingOf("javascript:alert(1)")).toBeNull();
    expect(meetingOf("")).toBeNull();
  });
});

describe("talking to it", () => {
  const names = wakeNames("X0 Bot");

  it("answers to X0 as people say it and speech-to-text writes it", () => {
    expect(names).toEqual(expect.arrayContaining(["x0", "x zero", "ex zero", "ex oh"]));
    expect(wakeNames("Nova from Leaf & Co")).toContain("nova");
    expect(wakeNames("The Notes Bot")).not.toContain("the");
  });

  it("hears its name at the start: set off, after a greeting, or before a question", () => {
    expect(addressed("X0, what did Ravi say about the launch date?", names)).toEqual({ to: true, asked: "what did Ravi say about the launch date?" });
    expect(addressed("Hey x zero what's next", names)).toEqual({ to: true, asked: "what's next" });
    expect(addressed("Ex oh, recap please", names)).toEqual({ to: true, asked: "recap please" });
    expect(addressed("X-0, leave the meeting", names)).toEqual({ to: true, asked: "leave the meeting" });
    expect(addressed("X0 can you sum up", names).to).toBe(true);
    // Its whole name, as its intro in the chat tells people to say it.
    expect(addressed("X0 Bot, what did Ravi say?", names)).toEqual({ to: true, asked: "what did Ravi say?" });
    expect(addressed("Nova, recap please", wakeNames("Nova"))).toEqual({ to: true, asked: "recap please" });
  });

  it("hears its name at the end of a question", () => {
    expect(addressed("What do you think, X0?", names).to).toBe(true);
    expect(addressed("Can you summarize so far X0", names).to).toBe(true);
  });

  it("takes just its name as said to it, with nothing asked yet", () => {
    expect(addressed("X0?", names)).toEqual({ to: true, asked: "" });
  });

  it("is not called by people talking about it", () => {
    expect(addressed("X0 is slow on Android", names).to).toBe(false);
    expect(addressed("X0 Bot is slow on Android", names).to).toBe(false);
    expect(addressed("The X0 app crashed yesterday", names).to).toBe(false);
    expect(addressed("We shipped it, X0 works now", names).to).toBe(false);
    expect(addressed("Let's move on", names).to).toBe(false);
  });

  it("stops talking, or leaves, when told", () => {
    expect(commandOf("stop")).toBe("stop");
    expect(commandOf("Stop talking please")).toBe("stop");
    expect(commandOf("leave the call")).toBe("leave");
    expect(commandOf("you can go now")).toBe("leave");
    expect(commandOf("what's the budget?")).toBeNull();
    expect(commandOf("stop the launch")).toBeNull();
  });
});
