/**
 * PLAN EASE'S WORDS OUTSIDE THE APP: THE ONE FUNCTION EVERY PUSH, NOTE AND WIDGET LINE GOES THROUGH (docs/plan-ease.md "Lock-screen safe").
 *
 * Android shows a notification's words on the lock screen by default, and an iPhone does whenever it is unlocked nearby; a widget sits
 * on the Home and Lock Screen for anyone to read. So whatever Plan Ease says there:
 *
 *   - never carries a ₹ amount ("Electricity ₹2,140" is "Electricity", and so are "Rent 25k" and "Electricity bill 2,140"): the
 *     amount is one tap away, in the app
 *   - writes a title that looks like health as "Appointment" ("Dentist · Dr. Mehta", "Blood test", "अस्पताल" all are)
 *   - is cut at a word to the length the place allows
 *
 * A family member's own words are never handed in at all: the writers (planNotes.ts, planEase.ts) only pass titles, times and names.
 * Pure: no imports.
 */

/** ₹ 2,140 · Rs. 300 · INR 1500 · 2140 rupees · 300/- · ₹1.2k · 25k · 1.5 lakh · 2 cr: every way an amount is written here. */
const AMOUNT = new RegExp([
  String.raw`(?:₹|\bRs\.?|\bINR)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K|lakh|lac|cr|crore)?`,
  String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:rupees|rupaye|rupaiye|rs|INR)\b`,
  String.raw`\b\d[\d,]*\/-`,
  // "Rent 25k", "Pay Ramesh 1.5 lakh": a number with a money size is money, whatever is around it.
  String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:k|K|lakhs?|lacs?|cr|crores?)\b`,
].join("|"), "gi");

/** Words that say the line is about money, so a bare number in it is one ("Maid salary 8,000", "Send 5000 to Priya"). */
const MONEY_WORD = /\b(?:pay|paying|paid|payment|fees?|rent|salary|bills?|emi|send|sending|transfer|due|dues|loan|deposit|refund|owe|owes|amount|recharge|premium|fine|balance|advance|tuition|donation|bharna|bhejo|paise|paisa)\b/i;

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const WEEKDAYS = "mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
/**
 * A bare number of 2 or more digits ("2,140", "8000", "50") that is not a day ("14th", "Sat 14", "14 Nov"), a time ("9:30", "5 pm"),
 * a length ("30 min") or a count ("12 more"). Only taken out when the line is about money (MONEY_WORD).
 */
const BARE = new RegExp(
  String.raw`(?<![\d:./-])(?<!\b(?:${MONTHS}|${WEEKDAYS})\.?\s)`
  + String.raw`(?:\d{1,3}(?:,\d{2,3})+|\d{2,})(?:\.\d{1,2})?`
  + String.raw`(?![\d:/]|\.\d|\s?(?:st|nd|rd|th|am|pm|a\.m|p\.m|hrs?|h|mins?|minutes?|hours?|days?|weeks?|months?|years?|yrs?|km|kms|m|more|things?|items?|people|others?|steps?|of|${MONTHS})\b)`,
  "gi");

/**
 * Words that make a title look like health. English, Hinglish, Hindi and Tamil. A test or a scan only with a medical word beside it, so
 * "Maths test" and "Scan the documents" stay what they are. This list errs on the side of too much: a meeting that reads as
 * "Appointment" outside the app costs nothing, a therapy session on a lock screen does.
 */
const HEALTH = new RegExp([
  String.raw`\b(?:doctors?|dr\.?|clinics?|hospitals?|dentists?|dental|medicines?|medication|medical|tablets?|pills?|physio\w*|`
    + String.raw`gyn\w*|obgyn|cardio\w*|ortho(?:paedic|pedic)?|derma\w*|neuro\w*|onco\w*|ent|ophthalm\w*|optometrist|`
    + String.raw`paediatrician|pediatrician|surgery|surgeon|vaccin\w*|injection|jab|pharmacy|chemist|prescription|check-?up|opd|`
    + String.raw`x-?ray|mri|ultrasound|sonography|usg|ecg|ekg|echo test|dialysis|chemo\w*|radiation|ivf|fertility|pregnancy|prenatal|antenatal|biopsy|`
    + String.raw`pathology|diagnostics?|hiv|std|sti|aids|abortion|miscarriage|mammo\w*|pap smear|root canal|insulin|diabet\w*|cholesterol|`
    + String.raw`cancer|tumou?r|rehab\w*|detox|aa meeting|nurse|midwife|blood pressure|mental health|sexual health|physical exam|health check\w*|`
    + String.raw`dawa(?:i|ai)?|davai|aspataal|aspatal|haspatal|ilaaj|jaanch|davakhana|vaidya)\b`,
  // Joined words count too: psychotherapy, psychiatry, counsellor, colonoscopy, urologist, orthodontist.
  String.raw`\w*therap\w*|\bpsych\w*|\bcounsel\w*|\w+scopy\b|\w+ologists?\b|\w+odontist\b|\w*odontic\w*`,
  String.raw`\b(?:covid|flu|booster|tetanus|polio|hep\w*|rabies|hpv)\s+(?:shots?|doses?|jabs?|vaccines?)\b|\bbooster\b`,
  String.raw`\b(?:blood|urine|stool|lab|covid|pcr|rt-?pcr|sugar|thyroid|bp|eye|hearing|allergy|pregnancy|medical|health|hba1c|lipid|liver|kidney)\s+(?:tests?|scans?|reports?|check)\b`,
  String.raw`\b(?:ct|pet|mri|bone|dexa|nt|anomaly|body)\s+scans?\b`,
  // Hindi and Tamil script: doctor (and its "Dr."), patient, hospital, medicine, test, treatment, clinic
  "डॉक्टर|डाक्टर|डॉ|मरीज़?|अस्पताल|दवा|दवाई|जांच|जाँच|इलाज|क्लिनिक|மருத்துவ|டாக்டர்|மருந்து|பரிசோதனை|சிகிச்சை|கிளினிக்",
].join("|"), "i");

/** The word a health-looking title becomes. */
export const APPOINTMENT = "Appointment";

/** Does this look like a health visit or a medicine? */
export const looksHealth = (s: string): boolean => HEALTH.test(s);

const tidy = (s: string): string => s
  .replace(/\(\s*\)/g, "")
  .replace(/\s+([,.;:])/g, "$1")
  .replace(/([,;:·])(?=[,;:·])/g, "")
  .replace(/^[\s,;:·-]+|[\s,;:·-]+$/g, "")
  .replace(/\s{2,}/g, " ")
  .trim();

/** The words without any amount in them; in a line about money, without its bare numbers either ("Maid salary 8,000" is "Maid salary"). */
export function noAmounts(s: string): string {
  const out = s.replace(AMOUNT, " ");
  return tidy(MONEY_WORD.test(out) ? out.replace(BARE, " ") : out);
}

/** At most `max` characters, cut at a word ("…" only when cut). */
export function cutAt(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const head = one.slice(0, Math.max(1, max - 1));
  const at = head.lastIndexOf(" ");
  return `${(at > max * 0.5 ? head.slice(0, at) : head).replace(/[\s,;:·.-]+$/, "")}…`;
}

/**
 * A thing's title as it may be said outside the app: "Appointment" when it looks like health, else the title with no amount in it
 * ("Electricity ₹2,140" is "Electricity"). Never empty: what had only an amount is "Payment".
 */
export function safeTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (looksHealth(t)) return APPOINTMENT;
  return noAmounts(t) || (t ? "Payment" : "");
}

/** Any line of Plan Ease's words for outside the app: no amount, cut at a word. Titles inside it went through safeTitle already. */
export function lockSafe(line: string, max = 178): string {
  return cutAt(noAmounts(line), max);
}
