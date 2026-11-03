/**
 * WHAT A SPOKEN ASK PUTS AT RISK, BY RULES ONLY: money moving, or something gone for good, in the languages people say it in.
 *
 *   riskOf(words, do) -> "money" | "delete" | "send" | "none"
 *   moneySaid(words), deleteSaid(words)
 *
 * The brain's model decides what was meant; these rules can only raise the risk it carries, never lower it (docs/ask-decide.md), and
 * a raised risk is never trusted: the computer asks before it happens. So the words are read here in every language X0 Bot is spoken
 * in, not only English and Hinglish: a "virement" in French or a "lösch" in German is as much money or a delete as "transfer" or
 * "delete". Each word is a stem at the start of a word: "überweis" holds überweisen and Überweisung. Word edges are letters
 * (\p{L}), not \b, which ends a word at ö or é.
 */
import type { AskDo, AskRisk } from "./index.js";

/** A stem at the start of a word, in any script. */
const stems = (list: string[]): RegExp => new RegExp(`(?<!\\p{L})(?:${list.join("|")})`, "iu");
/** Words in scripts with no spaces between words (Chinese, Japanese) and signs: anywhere. */
const anywhere = (list: string[]): RegExp => new RegExp(list.join("|"), "u");

const MONEY_STEMS = stems([
  // English, Hinglish
  "pay(?:s|ing|ment|ments)?(?!\\p{L})(?! (?:attention|heed|respect|a visit|tribute))", "paid(?!\\p{L})", "transfer", "send money", "buy", "buying", "purchas", "order(?!\\p{L})", "checkout", "check out",
  "book(?:ing)? (?:a |the )?(?:flight|ticket|hotel|room|cab|table)", "subscribe", "upi(?!\\p{L})", "gpay", "paytm", "phonepe", "bhim", "neft", "imps", "rtgs",
  "rupees?(?!\\p{L})", "rs\\.?\\s?\\d", "inr(?!\\p{L})", "usd(?!\\p{L})", "dollars?(?!\\p{L})", "euros?(?!\\p{L})", "pounds?(?!\\p{L})",
  "bhej(?:o|do)? paise", "paise bhej", "kharid", "bharo(?!\\p{L})", "payment kar", "pay kar",
  // Spanish, Portuguese, Italian, French
  "pag(?:ar|a|ue|o|amento|ate|ate)(?!\\p{L})", "transfer(?:ir|e|encia|ência|isci)", "compr(?:a|ar|e|ame|alo)(?!\\p{L})", "pedido", "reserv(?:a|ar)(?!\\p{L})",
  "pesos(?!\\p{L})", "reais(?!\\p{L})", "pix(?!\\p{L})", "bonifico", "acquist", "ordin(?:a|are)(?!\\p{L})", "prenot",
  "pai(?:e|er|ement)", "virement", "vir(?:e|er) (?:\\d|de l)", "achet", "command(?:e|er)(?!\\p{L})",
  // German, Dutch
  "bezahl", "zahl(?:e|en|ung)(?!\\p{L})", "überweis", "kauf(?:e|en)?(?!\\p{L})", "bestell", "betal", "overmak", "koop(?!\\p{L})", "kopen",
  // Turkish, Indonesian, Swahili
  "öde(?:me|yin|r)?(?!\\p{L})", "havale", "eft(?!\\p{L})", "satın al", "sipariş", "lira(?!\\p{L})", "bayar", "beli(?!\\p{L})", "rupiah",
  "lipa(?!\\p{L})", "malipo", "tuma pesa", "nunua", "shilingi", "m-?pesa",
  // Russian
  "оплат", "заплат", "перевед", "перевод", "купи", "покуп", "закаж", "заказ", "рубл",
  // Arabic
  "ادفع", "دفع", "حوّل", "حول مبلغ", "تحويل", "اشتر", "شراء", "ريال", "درهم", "جنيه", "دينار",
  // Bengali, Tamil, Korean
  "টাকা পাঠা", "পেমেন্ট", "কিনে", "পণ্য কেন", "பணம் அனுப்ப", "செலுத்த", "வாங்கு", "결제", "송금", "이체", "구매", "주문",
]);
const MONEY_ANY = anywhere(["[₹$€£¥₩₽]", "भुगतान", "पैसे भेज", "ख़रीद", "खरीद", "ऑर्डर", "पेमेंट",
  "付款", "支付", "转账", "轉帳", "汇款", "匯款", "购买", "購買", "下单", "订购", "充值", "块钱", "\\d+\\s*(?:元|块|円|원)",
  "支払", "払って", "払う", "送金", "振込", "振り込", "購入", "買って", "注文"]);

const DELETE_STEMS = stems([
  "delet", "remove", "erase", "wipe", "clear (?:all|everything|history)", "empty (?:the )?(?:trash|bin)", "uninstall", "format (?:my|the|this|disk|drive|phone|laptop|computer|pc|c:)",
  "cancel (?:my |the )?(?:account|subscription|order|plan)", "close (?:my |the )?account", "mita(?:o|do|na)?(?!\\p{L})", "hata(?:o|do|na)?(?!\\p{L})", "delete kar",
  "borr(?:a|ar|e)(?!\\p{L})", "elimin", "suprim", "supprim", "effac", "apag(?:a|ar|ue)(?!\\p{L})", "exclu(?:a|ir|i)(?!\\p{L})", "cancell", "rimuov",
  "lösch", "entfern", "verwijder", "wis(?:sen)?(?!\\p{L})", "sil(?:in|iniz)?(?!\\p{L})", "kaldır", "hapus", "futa(?!\\p{L})",
  "удали", "удалить", "сотри", "стереть", "احذف", "حذف", "امسح", "মুছে", "ডিলিট", "நீக்கு", "அழி", "삭제", "지워",
]);
const DELETE_ANY = anywhere(["मिटा", "हटा", "डिलीट", "删除", "删掉", "刪除", "清空", "削除", "消して", "消去"]);

export const moneySaid = (words: string): boolean => MONEY_STEMS.test(words) || MONEY_ANY.test(words);
export const deleteSaid = (words: string): boolean => DELETE_STEMS.test(words) || DELETE_ANY.test(words);

export function riskOf(words: string, d: AskDo): AskRisk {
  if (moneySaid(words)) return "money";
  if (deleteSaid(words)) return "delete";
  return d === "send" ? "send" : "none";
}
