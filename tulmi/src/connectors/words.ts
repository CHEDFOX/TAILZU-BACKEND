/**
 * THE ASSISTANT'S WORDS: connected apps, tasks and the confirm card, in the
 * two voices of the approved design (the EN and HG copy objects of the
 * assistant prototype). One table, so a word is the same on every surface:
 * Connect, Can look / Can draft / Can send, Approve, Not now.
 *
 * The bot speaks as "I": warm and short, says what it will do and what it
 * won't, never blames. A few lines are the design's own with the one thing
 * that varies made a {slot}.
 *
 * Two ways in:
 *   - The desk's pages are built in English and translated for the person's
 *     language like every other desk string (experience/i18n.ts). For
 *     Hinglish that translation would be a model's guess at words that already
 *     have a written form here, so `HINGLISH_SEEDS` hands i18n the design's
 *     own, line for line, for every app the catalog knows.
 *   - The confirm card travels in the agent's stream, which nothing
 *     localizes, so `wordsFor(language)` picks the voice there.
 */

export type WordKey = keyof typeof EN;

export const EN = {
  // Connected apps
  "apps.h": "Connected apps",
  "apps.p": "What I can reach, and how far I can go.",
  connect: "Connect",
  "st.ok": "Connected",
  "st.re": "Sign in again",
  "st.no": "Not connected",
  "lv.look": "Can look",
  "lv.look.d": "I can read, but I never change anything.",
  "lv.draft": "Can draft",
  "lv.draft.d": "I write drafts for you. Nothing goes out.",
  "lv.send": "Can send",
  "lv.send.d": "I can send for you, the way you’ve approved.",
  "a2.q": "How far can I go in {app}?",
  "a2.foot": "Change this any time. If you disconnect, my access ends right away.",
  // Said before the sign-in page opens (Google's rule: the use is told in the
  // app, right before the ask, not only in the privacy policy).
  "a2.ai": "I only use {app} when you ask. What I read there goes to an AI model (OpenAI or Anthropic, through OpenRouter) just to answer you, never for ads or training.",
  "a2.dis": "Disconnect {app}",
  "link.ph": "Paste the link {app} gave you",
  "err.level": "I couldn’t change that. Try again.",
  "err.connect": "I couldn’t start that. Try again.",
  "err.generic": "That didn’t work. Try again.",
  // Tasks
  "a4.h": "Tasks",
  "tasks.h": "What I’m doing in your apps",
  "a4.w": "Waiting for you",
  "a4.r": "Running",
  "a4.d": "Done",
  "a4.wm": "{app} · needs your OK",
  "a4.end": "That’s everything.",
  "tasks.empty": "Nothing yet. Ask me to do something in your apps, and it shows up here.",
  // The confirm card
  "a3.ok": "Approve",
  "a3.edit": "Edit",
  "a3.later": "Not now",
  "a3.h.send": "Ready to send?",
  "a3.h.write": "Ready to make this change?",
  "a3.h.destructive": "Ready to delete this?",
  "a3.h.pay": "Ready to pay?",
  "a3.h.read": "Okay to look this up?",
  "a3.lab.send": "The exact message",
  "a3.lab.other": "The exact change",
  "a3.lab.read": "What I’ll send it",
  "a3.wwl": "I’ll do this in {app}, as you. I won’t do anything else.",
  "a3.once": "Approve once, and I’ll do this in {app} without asking again. Deleting always asks.",
  "a3.done": "Done ✓",
  "a3.left": "Okay, I left it.",
  "a3.failed": "That didn’t go through.",
  "a3.change": "What should I change?",
  // The phone's own lines (the design's, plus the few it needs that the desk does not)
  "s6.sug": "Suggested for you",
  "s6.more": "More apps",
  "apps.off": "I can’t reach your apps just yet.",
  "apps.update": "Update Tailzu to connect an app from your phone.",
  "a3.none": "Nothing is waiting for you right now.",
  "a3.reason": "Approve this in {app}",
  "a3.nobio": "No Face ID or fingerprint is set up on this phone, so I’ll just ask once more.",
  // The email hand-off: Gmail opened with the email written; the person sends it.
  "mail.done": "I've written it in Gmail. Check it and hit Send.",
  "mail.open": "Open in Gmail",
  // Apps added by link (CUSTOM_CONNECTORS). Nobody here checked them, and the
  // words say so plainly, once, without alarm: what it is, where you'll sign
  // in, and that I ask first.
  "add.h": "Add an app by link",
  "add.tile": "Add by link",
  "add.p": "Any app with an MCP link can work with me.",
  "add.name": "Name",
  "add.name.ph": "What should I call it?",
  "add.link": "Link",
  "add.link.ph": "Paste its MCP link, https://…",
  "add.adv": "Advanced",
  "add.adv.d": "Only if the app gave you a client of your own. Most don’t need this.",
  "add.cid": "Client ID",
  "add.csec": "Client secret",
  "add.trust": "Tailzu hasn’t checked this app. Only add apps you trust.",
  "add.go": "Add app",
  "add.at": "You’ll sign in at",
  "add.cont": "Continue",
  "add.done": "Added. It’s in your apps now.",
  "err.add": "I couldn’t add that just now. Try again.",
  "custom.tag": "Unverified",
  "custom.note": "Tailzu hasn’t checked this app, so I ask before most things in it.",
  "custom.remove": "Remove this app",
  // What an added app can do, tool by tool
  "tools.h": "What it can do",
  "tools.p": "Choose what I may do in it on my own, and what I ask you first.",
  "pol.allow": "Allow",
  "pol.ask": "Ask first",
  "pol.off": "Off",
  "tools.always": "Anything that deletes or pays always asks you first.",
  "tools.err": "I couldn’t reach this app just now. Try again in a bit.",
  "tools.none": "It doesn’t offer anything yet.",
  "tools.back": "Back to your apps",
  "changed.h": "This app changed. Have a look.",
  "changed.p": "I won’t use what changed until you say it looks right.",
  "changed.ok": "Looks right",
  "changed.tag": "Changed",
  "changed.look": "Have a look",
  // More apps: our own first, then the public MCP Registry's
  "dir.p": "Apps from the public MCP Registry. Tailzu hasn’t checked them.",
  "dir.ph": "Search for an app",
  "dir.go": "Search",
  "dir.ours": "Checked by Tailzu",
  "dir.ours.d": "It’s already in your apps.",
  "dir.none": "Nothing by that name. Try another word.",
  "dir.add": "Add",
  "dir.err": "I couldn’t search just now. Try again.",
  // The other hand-offs (handoffs/): the app opened with everything filled
  // in, one line said, and the person finishes it there. {name}, {place},
  // {query} and {amount} are their own words.
  "ho.phone": "That one's for your phone. Ask me there.",
  "ho.failed": "I couldn't open that one. Try asking another way.",
  "ho.read": "I only fill in a number, username or UPI ID you give me, not one I read in another app. Who should it go to?",
  // This computer: the plan card for the person's own files, and what is said when it can't be done.
  "dv.title": "Okay to change these files?",
  "dv.titleTrash": "Move these to the Trash?",
  "dv.label": "What I’ll do",
  "dv.note": "Approve once, and I’ll do this kind of change on this computer without asking again. I only touch the folders you allowed, and I can undo it.",
  "dv.noteTrash": "Moving to the Trash always asks. You can put things back from the Trash.",
  "dv.ok": "Approve",
  "dv.later": "Not now",
  "dv.done": "Done ✓",
  "dv.left": "Okay, I left your files alone.",
  "dv.failed": "That didn’t all go through.",
  "dv.working": "Working on your files…",
  "dv.organise": "I’ll move {n} files into {m} folders inside {to}.",
  "dv.move": "I’ll move {n} files to {to}.",
  "dv.copy": "I’ll copy {n} files to {to}.",
  "dv.rename": "I’ll rename {from} to {to}.",
  "dv.makeFolder": "I’ll make a folder called {to}.",
  "dv.trash": "I’ll move {n} files to the Trash.",
  "dv.undo": "I’ll undo the last change ({n} files).",
  "dv.more": "…and {n} more",
  "dv.show": "Ask me as a command and I’ll do that to your files.",
  "dv.off": "I can only reach your files from the Tailzu app on your computer. Ask me there.",
  "wa.done": "WhatsApp is open with your message. Just hit Send.",
  "wa.done.to": "{name}'s chat is open with your message. Just hit Send.",
  "wa.pick": "WhatsApp is open with your message. Pick the chat and hit Send.",
  "wa.pick.to": "WhatsApp is open with your message for {name}. Pick their chat and hit Send.",
  "wa.open": "Open WhatsApp",
  "tg.done.to": "{name}'s chat is open in Telegram with your message. Just hit Send.",
  "tg.pick": "Telegram is open with your message. Pick the chat and hit Send.",
  "tg.pick.to": "Telegram is open with your message for {name}. Pick their chat and hit Send.",
  "tg.open": "Open Telegram",
  "call.done": "Ready to call {name}. Just tap Call.",
  "call.open": "Call now",
  "sms.done.to": "Your text to {name} is written. Just hit Send.",
  "sms.pick": "Your text is written. Pick who it's for and hit Send.",
  "sms.open": "Open Messages",
  "upi.done": "Your UPI app is open: ₹{amount} to {name}. Check it, then enter your PIN.",
  "upi.open": "Pay with UPI",
  "maps.dir": "Directions to {place} are open in Google Maps.",
  "maps.find": "{place} is open in Google Maps.",
  "maps.open": "Open Google Maps",
  "uber.done": "Uber is open with {place} as your drop. Check the ride and book it.",
  "uber.open": "Open Uber",
  "shop.amazon": "Here's {query} on Amazon. Pick the one you like.",
  "shop.flipkart": "Here's {query} on Flipkart. Pick the one you like.",
  "shop.open.amazon": "Open Amazon",
  "shop.open.flipkart": "Open Flipkart",
  "play.yt": "Here's {query} on YouTube. Tap the one you want.",
  "play.ytm": "Here's {query} on YouTube Music. Just tap play.",
  "play.spotify": "Here's {query} on Spotify. Just tap play.",
  "play.open.yt": "Open YouTube",
  "play.open.ytm": "Open YouTube Music",
  "play.open.spotify": "Open Spotify",
  "threads.done": "Your post is written in Threads. Check it and hit Post.",
  "threads.open": "Open Threads",
  "booking.done": "Hotels in {place} are open on Booking.com. Pick one you like.",
  "booking.open": "Open Booking.com",
  // The phone's Ask (assistant_ask, POST /v1/assistant/ask)
  "ask.h": "Ask me",
  "ask.p": "Tell me what to do, and I’ll open the right app with it ready.",
  "ask.ph": "Type or say what you need",
  "ask.go": "Do it",
  "ask.mic": "Speak",
  "ask.try": "Try saying",
  "ask.busy": "On it…",
  "ask.empty": "Tell me what to do first.",
  "ask.approve": "It’s ready. Check it and tap Approve.",
  "ask.desk": "That one needs your computer’s screen. Ask me there.",
  "ask.none": "I couldn’t do that from here.",
  "ask.ex1": "Tell Mom I’m on my way on WhatsApp",
  "ask.ex2": "Kal 9 baje gym ka reminder",
  "ask.ex3": "Directions to the airport",
} as const;

export const HG: Record<WordKey, string> = {
  "apps.h": "Jude hue apps",
  "apps.p": "Main kahan tak pahunch sakta hoon, aur kitna kar sakta hoon.",
  connect: "Jodo",
  "st.ok": "Jud gaya",
  "st.re": "Dobara sign in karo",
  "st.no": "Jura nahi",
  "lv.look": "Dekh sakta hoon",
  "lv.look.d": "Main padh sakta hoon, kuch badalta nahi.",
  "lv.draft": "Draft kar sakta hoon",
  "lv.draft.d": "Main draft likhta hoon. Kuch bahar nahi jaata.",
  "lv.send": "Bhej sakta hoon",
  "lv.send.d": "Aapke approve kiye tareeke se main bhej sakta hoon.",
  "a2.q": "{app} mein main kitna kar sakta hoon?",
  "a2.foot": "Kabhi bhi badlo. Disconnect karte hi meri pahunch turant band.",
  "a2.ai": "Main {app} tabhi use karta hoon jab aap kaho. Wahan jo padhta hoon, woh sirf aapko jawab dene ke liye ek AI model (OpenAI ya Anthropic, OpenRouter ke through) ke paas jaata hai, kabhi ads ya training ke liye nahi.",
  "a2.dis": "{app} hatao",
  "link.ph": "{app} ne jo link diya hai, woh paste karo",
  "err.level": "Yeh nahi badal paaya. Dobara try karo.",
  "err.connect": "Yeh shuru nahi ho paaya. Dobara try karo.",
  "err.generic": "Yeh nahi hua. Dobara try karo.",
  "a4.h": "Kaam",
  "tasks.h": "Aapke apps mein main kya kar raha hoon",
  "a4.w": "Aapka intezaar",
  "a4.r": "Chal rahe hain",
  "a4.d": "Ho gaye",
  "a4.wm": "{app} · aapki haan chahiye",
  "a4.end": "Bas, itna hi.",
  "tasks.empty": "Abhi kuch nahi. Apne apps mein kuch karne ko bolo, yahin dikhega.",
  "a3.ok": "Approve karo",
  "a3.edit": "Badlo",
  "a3.later": "Abhi nahi",
  "a3.h.send": "Bhejne ke liye taiyaar?",
  "a3.h.write": "Yeh badlav karne ke liye taiyaar?",
  "a3.h.destructive": "Yeh hatane ke liye taiyaar?",
  "a3.h.pay": "Payment karne ke liye taiyaar?",
  "a3.h.read": "Yeh dekh loon?",
  "a3.lab.send": "Bilkul yahi message",
  "a3.lab.other": "Bilkul yahi badlav",
  "a3.lab.read": "Main ise yeh bhejunga",
  "a3.wwl": "Main yeh {app} mein aapke naam se karunga. Aur kuch nahi karunga.",
  "a3.once": "Ek baar Approve karo, phir {app} mein yeh bina pooche karunga. Delete hamesha pooch ke.",
  "a3.done": "Ho gaya ✓",
  "a3.left": "Theek hai, chhod diya.",
  "a3.failed": "Yeh nahi ho paaya.",
  "a3.change": "Kya badlun?",
  "s6.sug": "Aapke liye",
  "s6.more": "Aur apps",
  "apps.off": "Abhi main aapke apps tak nahi pahunch sakta.",
  "apps.update": "Phone se app jodne ke liye Tailzu update karo.",
  "a3.none": "Abhi aapka intezaar karne wala kuch nahi hai.",
  "a3.reason": "Ise {app} mein approve karo",
  "a3.nobio": "Is phone mein Face ID ya fingerprint set nahi hai, isliye main ek baar aur poochhunga.",
  "mail.done": "Maine Gmail mein likh diya hai. Check karo aur Send dabao.",
  "mail.open": "Gmail mein kholo",
  "add.h": "Link se app jodo",
  "add.tile": "Link se jodo",
  "add.p": "Jis app ka MCP link ho, woh mere saath kaam kar sakta hai.",
  "add.name": "Naam",
  "add.name.ph": "Ise kya bulaun?",
  "add.link": "Link",
  "add.link.ph": "Iska MCP link paste karo, https://…",
  "add.adv": "Advanced",
  "add.adv.d": "Sirf tab, jab app ne aapko apna client diya ho. Zyaadatar ko iski zaroorat nahi.",
  "add.cid": "Client ID",
  "add.csec": "Client secret",
  "add.trust": "Tailzu ne yeh app check nahi kiya hai. Sirf woh apps jodo jin par aapko bharosa ho.",
  "add.go": "App jodo",
  "add.at": "Sign in yahan hoga:",
  "add.cont": "Aage badho",
  "add.done": "Jud gaya. Ab yeh aapke apps mein hai.",
  "err.add": "Abhi yeh jud nahi paaya. Dobara try karo.",
  "custom.tag": "Check nahi hua",
  "custom.note": "Tailzu ne yeh app check nahi kiya, isliye ismein zyaadatar kaam se pehle main poochhunga.",
  "custom.remove": "Yeh app hatao",
  "tools.h": "Yeh kya kar sakta hai",
  "tools.p": "Chuno ki ismein main khud se kya kar sakta hoon, aur kis cheez se pehle aapse poochhun.",
  "pol.allow": "Allow",
  "pol.ask": "Pehle poochho",
  "pol.off": "Band",
  "tools.always": "Kuch bhi delete ya payment karne se pehle main hamesha poochhunga.",
  "tools.err": "Abhi is app tak nahi pahunch paaya. Thodi der mein try karo.",
  "tools.none": "Yeh abhi kuch nahi deta.",
  "tools.back": "Apne apps par wapas",
  "changed.h": "Yeh app badal gaya hai. Ek baar dekh lo.",
  "changed.p": "Jab tak aap theek na kaho, jo badla hai woh main use nahi karunga.",
  "changed.ok": "Theek hai",
  "changed.tag": "Badla hai",
  "changed.look": "Dekh lo",
  "dir.p": "Public MCP Registry ke apps. Tailzu ne inhe check nahi kiya.",
  "dir.ph": "App dhoondo",
  "dir.go": "Dhoondo",
  "dir.ours": "Tailzu ka check kiya hua",
  "dir.ours.d": "Yeh pehle se aapke apps mein hai.",
  "dir.none": "Is naam se kuch nahi mila. Koi aur shabd try karo.",
  "dir.add": "Jodo",
  "dir.err": "Abhi dhoondh nahi paaya. Dobara try karo.",
  "ho.phone": "Yeh kaam phone pe hota hai. Mujhse wahan poochho.",
  "ho.failed": "Yeh khul nahi paaya. Kisi aur tareeke se poochho.",
  "ho.read": "Main wahi number, username ya UPI ID bharta hoon jo tum khud batao, kisi aur app mein padha hua nahi. Kisko bhejna hai?",
  "dv.title": "Ye files badalne ki ijazat hai?",
  "dv.titleTrash": "Inhe Trash mein daalu?",
  "dv.label": "Main ye karunga",
  "dv.note": "Ek baar Approve karo, phir is tarah ka badlav main bina pooche karunga. Main sirf wahi folders chhoota hoon jo tumne allow kiye, aur ise undo bhi kar sakta hoon.",
  "dv.noteTrash": "Trash mein daalne se pehle main hamesha poochta hoon. Trash se wapas bhi la sakte ho.",
  "dv.ok": "Approve karo",
  "dv.later": "Abhi nahi",
  "dv.done": "Ho gaya ✓",
  "dv.left": "Theek hai, files ko haath nahi lagaya.",
  "dv.failed": "Sab kuch nahi ho paaya.",
  "dv.working": "Files par kaam chal raha hai…",
  "dv.organise": "Main {n} files ko {to} ke andar {m} folders mein daalunga.",
  "dv.move": "Main {n} files ko {to} mein le jaunga.",
  "dv.copy": "Main {n} files ki copy {to} mein banaunga.",
  "dv.rename": "Main {from} ka naam badal ke {to} karunga.",
  "dv.makeFolder": "Main {to} naam ka folder banaunga.",
  "dv.trash": "Main {n} files Trash mein daalunga.",
  "dv.undo": "Main pichla badlav undo karunga ({n} files).",
  "dv.more": "…aur {n} aur",
  "dv.show": "Mujhe command ki tarah bolo, tab main tumhari files par ye karunga.",
  "dv.off": "Main files tak sirf computer ke Tailzu app se pahunch sakta hoon. Mujhse wahan poochho.",
  "wa.done": "WhatsApp khol diya, message likha hai. Bas Send dabao.",
  "wa.done.to": "{name} ki chat khul gayi, message likha hai. Bas Send dabao.",
  "wa.pick": "WhatsApp khol diya, message likha hai. Chat chuno aur Send dabao.",
  "wa.pick.to": "WhatsApp khol diya, {name} ke liye message likha hai. Unki chat chuno aur Send dabao.",
  "wa.open": "WhatsApp kholo",
  "tg.done.to": "Telegram mein {name} ki chat khul gayi, message likha hai. Bas Send dabao.",
  "tg.pick": "Telegram khol diya, message likha hai. Chat chuno aur Send dabao.",
  "tg.pick.to": "Telegram khol diya, {name} ke liye message likha hai. Unki chat chuno aur Send dabao.",
  "tg.open": "Telegram kholo",
  "call.done": "{name} ko call karne ke liye taiyaar. Bas Call dabao.",
  "call.open": "Abhi call karo",
  "sms.done.to": "{name} ke liye message likh diya hai. Bas Send dabao.",
  "sms.pick": "Message likh diya hai. Kisko bhejna hai chuno aur Send dabao.",
  "sms.open": "Messages kholo",
  "upi.done": "UPI app khul gaya: {name} ko ₹{amount}. Check karo, phir apna PIN daalo.",
  "upi.open": "UPI se pay karo",
  "maps.dir": "{place} ka raasta Google Maps mein khul gaya.",
  "maps.find": "Google Maps mein {place} khul gaya.",
  "maps.open": "Google Maps kholo",
  "uber.done": "Uber khul gaya, drop {place} pe set hai. Ride dekho aur book karo.",
  "uber.open": "Uber kholo",
  "shop.amazon": "Amazon pe {query} khol diya. Jo pasand aaye, chuno.",
  "shop.flipkart": "Flipkart pe {query} khol diya. Jo pasand aaye, chuno.",
  "shop.open.amazon": "Amazon kholo",
  "shop.open.flipkart": "Flipkart kholo",
  "play.yt": "YouTube pe {query} khol diya. Jo chahiye, tap karo.",
  "play.ytm": "YouTube Music pe {query} khol diya. Bas play dabao.",
  "play.spotify": "Spotify pe {query} khol diya. Bas play dabao.",
  "play.open.yt": "YouTube kholo",
  "play.open.ytm": "YouTube Music kholo",
  "play.open.spotify": "Spotify kholo",
  "threads.done": "Threads mein post likh diya hai. Check karo aur Post dabao.",
  "threads.open": "Threads kholo",
  "booking.done": "Booking.com pe {place} ke hotels khul gaye. Jo pasand aaye, chuno.",
  "booking.open": "Booking.com kholo",
  "ask.h": "Mujhse poochho",
  "ask.p": "Bolo kya karna hai, main sahi app taiyaar karke khol dunga.",
  "ask.ph": "Likho ya bolo, kya chahiye",
  "ask.go": "Kar do",
  "ask.mic": "Bolo",
  "ask.try": "Aise bolke dekho",
  "ask.busy": "Kar raha hoon…",
  "ask.empty": "Pehle batao kya karna hai.",
  "ask.approve": "Taiyaar hai. Check karo aur Approve dabao.",
  "ask.desk": "Iske liye computer ki screen chahiye. Mujhse wahan poochho.",
  "ask.none": "Yeh main yahan se nahi kar paaya.",
  "ask.ex1": "Mom ko WhatsApp pe bolo main raaste mein hoon",
  "ask.ex2": "Kal 9 baje gym ka reminder",
  "ask.ex3": "Airport ka raasta dikhao",
};

/**
 * The Google apps' one-liners (catalog.ts `oneLine`, which stays English for
 * the router) in the design's Hinglish, by catalog id: handed to the
 * translator like the table above, so a Hinglish desk reads these and not a
 * model's guess.
 */
export const HG_APP_LINES: Readonly<Record<string, string>> = {
  "google-calendar": "Apna schedule dekho, free time dhoondho, aur Google Calendar mein events add, move ya cancel karo.",
  "google-docs": "Apne shabdon se nayi Google Doc likhwao, ya meeting note ko Doc bana do.",
  "google-tasks": "Apni to-do list dekho, kisi din ke liye kaam ya reminder add karo, Google Tasks mein tick karo ya hatao.",
  "google-sheets": "Google Sheet shuru karo, usme rows jodo ya padhwao: kharche ka hisaab, list, table.",
  "google-forms": "Google Form banao (survey, quiz, poll) sawaalon ke saath, aur dekho kisne kya jawab diya.",
  "google-classroom": "Google Classroom mein apni classes dekho, kaunsa classwork aur homework due hai aur jama kiya ya nahi, aur naye announcements.",
};

/** Hinglish is the one voice with its own table; every other language reads English. */
export const isHinglish = (language: string | undefined): boolean => /^hinglish\b/i.test((language ?? "").trim());

/** The word table for a language, as a function: `w("connect")`, `w("a2.q", { app: "Gmail" })`. */
export function wordsFor(language?: string): (key: WordKey, vars?: Record<string, string>) => string {
  const table: Record<WordKey, string> = isHinglish(language) ? HG : EN;
  return (key, vars) => fill(table[key] ?? EN[key], vars);
}

/** The English words, for the pages translated afterwards. */
export const en = wordsFor("en");

function fill(s: string, vars?: Record<string, string>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m) : s;
}

/**
 * English line -> the design's Hinglish line, for the translator to use as it
 * is. A line with an {app} slot is written out for each app named, since the
 * translator is asked about whole strings; an app's one-liner is seeded when
 * HG_APP_LINES has it.
 */
export function hinglishSeeds(appNames: readonly string[], apps: ReadonlyArray<{ id: string; oneLine: string }> = []): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const a of apps) if (HG_APP_LINES[a.id]) seeds.set(a.oneLine, HG_APP_LINES[a.id]!);
  for (const key of Object.keys(EN) as WordKey[]) {
    const from = EN[key] as string;
    if (from.includes("{app}")) {
      for (const app of appNames) seeds.set(fill(from, { app }), fill(HG[key], { app }));
    } else {
      seeds.set(from, HG[key]);
    }
  }
  return seeds;
}
