/**
 * WHERE AWARENESS STOPS. The clients do not read a password field, a banking
 * app, or a private browser window — but the server is the last gate, so it
 * checks too: a request marked private, or one whose app reads as money or
 * health, is written from what they said alone. No surroundings off the
 * screen, and not even their own prior text, because in these apps that text
 * is a balance, a card number, a diagnosis.
 *
 * Matched on the app NAME the client sends ("Chase", "HDFC Bank: NetBanking",
 * "1Password"), loosely, because that name is all the server has. A false
 * match costs only a little context on one message; a miss would send a bank
 * statement to the model.
 */
const SENSITIVE = /\b(?:bank|banking|netbanking|chase|wells\s*fargo|citi(?:bank)?|barclays|hsbc|lloyds|santander|hdfc|icici|axis|kotak|sbi|paytm|phonepe|gpay|google\s*pay|venmo|zelle|cash\s*app|revolut|monzo|wise|coinbase|binance|metamask|robinhood|fidelity|schwab|paypal|stripe|credit\s*card|debit\s*card|1password|bitwarden|lastpass|dashlane|keeper|authenticator|wallet|tax|irs|hmrc|health|patient|medical|clinic|hospital|insur\w*)\b/i;

/** The screen text, bounded: one blob, its fence tags gone, cut to a few
 *  thousand characters from the END (in a chat the newest lines, nearest the
 *  field, are what a reply answers). Oversized input never rejects a
 *  dictation — the screen is a help, not the message. */
const SURROUNDINGS_MAX = 4000;
export function capSurroundings(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!s) return undefined;
  return (s.length > SURROUNDINGS_MAX ? s.slice(-SURROUNDINGS_MAX) : s);
}

/** True when this app's screen should not be read (money, health, secrets). */
export function sensitiveApp(targetApp?: string): boolean {
  return !!targetApp && SENSITIVE.test(targetApp);
}

/** True when nothing off the screen, and not even their own prior text,
 *  should ride with this request. */
export function screenIsOffLimits(opts: { targetApp?: string; privateField?: boolean }): boolean {
  return !!opts.privateField || sensitiveApp(opts.targetApp);
}
