/**
 * The one key's rules in the languages it is spoken in (src/askDecide/risk.ts, acts.ts): money and deleting are seen in about twenty
 * languages and never trusted; a send said in so many words is a send, money or a delete called chat is a task; a question is neither.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { moneySaid, deleteSaid, riskOf } = await import("../src/askDecide/risk.js");
const { sendSaid } = await import("../src/askDecide/acts.js");
const { decideAsk, resetAskDecideCacheForTests, AskDecideReply } = await import("../src/askDecide/index.js");
type CallFn = import("../src/code/work/model.js").CallFn;

const said = (reply: Record<string, unknown>) => (async () => {
  const json = AskDecideReply.parse({ goal: "", screen: false, web: false, sure: 0.9, ...reply });
  return { text: JSON.stringify(json), json, toolCalls: [], model: "m", promptTokens: 1, completionTokens: 1, costUsd: 0, paise: 1, costSource: "estimated", truncated: false, ms: 1, calls: 1, trail: [] };
}) as unknown as CallFn;

describe("money and deleting, in the languages people say them in", () => {
  it.each([
    "fais un virement de 200 euros à Marc", "überweise 50 Euro an Anna", "paga la factura de la luz", "transfira 100 reais pro Pedro",
    "给小李转账500块", "田中さんに5000円送金して", "엄마한테 5만원 송금해줘", "переведи Ольге 1000 рублей", "Ahmet'e 200 lira havale yap",
    "bayar tagihan listrik", "lipa bili ya umeme kwa M-Pesa", "حوّل 100 ريال إلى أحمد", "pay the electricity bill", "Riya ko 500 rupees bhej do",
  ])("money: %s", (w) => {
    expect(moneySaid(w)).toBe(true);
    expect(riskOf(w, "task")).toBe("money");
  });

  it.each([
    "lösch alle meine alten Fotos aus Google Drive", "borra todos mis correos de 2019", "supprime mes anciens fichiers", "apaga as fotos antigas",
    "cancella tutte le email vecchie", "删除我所有的旧照片", "古い写真を全部削除して", "오래된 사진 다 삭제해줘", "удали все старые письма",
    "eski fotoğrafları sil", "hapus semua foto lama", "futa picha zote za zamani", "احذف كل الصور القديمة", "purani files mita do",
  ])("delete: %s", (w) => {
    expect(deleteSaid(w)).toBe(true);
    expect(riskOf(w, "task")).toBe("delete");
  });

  it.each(["what's the weather in Paris", "explique-moi pourquoi le ciel est bleu", "erinnere mich morgen um 8", "how do I pay attention in class?",
    "silence please", "that's a great format idea", "translate hello into German"])("neither: %s", (w) => {
    expect(riskOf(w, "answer")).toBe("none");
  });
});

describe("a send said in so many words", () => {
  it.each(["给王经理发微信说报告明天上午交", "田中さんにLINEで明日の会議は10時からと送って", "envoie un mail à Julien", "mándale eso a Lucía por WhatsApp",
    "엄마한테 카톡으로 간다고 보내줘", "напиши Ольге в Телеграм", "tuma ujumbe kwa Amina kwenye WhatsApp", "أرسل رسالة واتساب لأحمد"])("is a send: %s", (w) => {
    expect(sendSaid(w)).toBe(true);
  });

  it.each(["what's new in WhatsApp?", "how do I send a big file on Telegram?", "I love the new Gmail design", "tell me a joke"])("is not: %s", (w) => {
    expect(sendSaid(w)).toBe(false);
  });
});

describe("the brain holds to them whatever its model said", () => {
  it("a send the model called chat is a send; money it called chat is an untrusted task; a question stays an answer", async () => {
    resetAskDecideCacheForTests();
    expect(await decideAsk({ words: "给王经理发微信说报告明天上午交", field: null }, "u", { call: said({ do: "chat" }) })).toMatchObject({ do: "send", risk: "send" });
    resetAskDecideCacheForTests();
    expect(await decideAsk({ words: "给小李转账500块", field: null }, "u", { call: said({ do: "chat" }) })).toMatchObject({ do: "task", risk: "money" });
    resetAskDecideCacheForTests();
    expect(await decideAsk({ words: "fais un virement de 200 euros à Marc", field: null }, "u", { call: said({ do: "task" }) })).toMatchObject({ do: "task", risk: "money" });
    resetAskDecideCacheForTests();
    expect(await decideAsk({ words: "combien coûte un virement international ?", field: null }, "u", { call: said({ do: "chat" }) })).toMatchObject({ do: "answer" });
  });

  it("dictation into a text box that mentions an app stays dictation", async () => {
    resetAskDecideCacheForTests();
    expect(await decideAsk({ words: "I'll send you the deck on WhatsApp tonight", field: {} }, "u", { call: said({ do: "write" }) })).toMatchObject({ do: "write" });
  });
});
