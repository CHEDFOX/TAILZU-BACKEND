import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { titleCase, titleCaseScreen } from "../src/experience/titleCase.js";
// eslint-disable-next-line import/first
import { buildBootstrap, buildScreen } from "../src/experience/catalog.js";

describe("every word starts with a capital", () => {
  it("capitalises each word, and each part of a joined one", () => {
    expect(titleCase("nothing yet today.")).toBe("Nothing Yet Today.");
    expect(titleCase("just a clean-up")).toBe("Just A Clean-Up");
    expect(titleCase("it doesn't sound like me")).toBe("It Doesn't Sound Like Me");
    expect(titleCase("(say it again)")).toBe("(Say It Again)");
  });

  it("leaves links, brands, units, keys and other scripts alone", () => {
    expect(titleCase("open tailzu.space now")).toBe("Open tailzu.space Now");
    expect(titleCase("mail hi@tailzu.space")).toBe("Mail hi@tailzu.space");
    expect(titleCase("works on iPhone and macOS")).toBe("Works On iPhone And macOS");
    expect(titleCase("typed, it took 15 min and 1 h 05")).toBe("Typed, It Took 15 min And 1 h 05");
    expect(titleCase("from 9 am")).toBe("From 9 am");
    expect(titleCase("@history.title")).toBe("@history.title");
    expect(titleCase("$state.vcToast")).toBe("$state.vcToast");
    expect(titleCase("{n} learned")).toBe("{n} Learned");
    expect(titleCase("हिंदी में लिखो")).toBe("हिंदी में लिखो");
  });

  it("keeps a marked node, and a bound one, exactly as written", () => {
    const s = titleCaseScreen({
      schemaVersion: 1, screenId: "x", title: "a title",
      root: { type: "Stack", children: [
        { type: "Text", props: { content: "app copy here" } },
        { type: "Stack", props: { keepCase: true }, children: [{ type: "Text", props: { content: "haan bhai, kal milte hain" } }] },
        { type: "Text", bind: { content: "item.output" }, props: { content: "" } },
        { type: "Button", props: { label: "leave it" } },
      ] },
      actions: { t: { kind: "toast", message: "couldn't reach history" } },
    } as never) as any;
    expect(s.title).toBe("A Title");
    expect(s.root.children[0].props.content).toBe("App Copy Here");
    expect(s.root.children[1].children[0].props.content).toBe("haan bhai, kal milte hain");
    expect(s.root.children[2].props.content).toBe("");
    expect(s.root.children[3].props.label).toBe("Leave It");
    expect(s.actions.t.message).toBe("Couldn't Reach History");
  });

  it("reaches every phone screen and the phone's copy, and leaves the desk's alone", () => {
    const stats = JSON.stringify(buildScreen("stats", { personality: {}, language: "en" } as never));
    expect(stats).toContain("Nothing Here Yet.");
    const phone = buildBootstrap({}) as any;
    expect(phone.labels["history.subtitle"]).toMatch(/^Every Cleanup You've Kept, Newest First\./);
    const desk = buildBootstrap({ formFactor: "desktop" } as never) as any;
    expect(desk.labels["history.subtitle"]).toMatch(/^Every cleanup you've kept/);
  });

  it("keeps the dictionary's words and the voices' samples as they are written", () => {
    const you = JSON.stringify(buildScreen("personality", {
      personality: { dictionary: [{ word: "tail zoo", replacement: "tailzu app" }] }, language: "en",
    } as never));
    expect(you).toContain('"tail zoo"');
    expect(you).toContain('"tailzu app"');
  });
});
