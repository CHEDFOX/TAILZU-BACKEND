/**
 * The website's copy (x0bot.com), read by seo/ and the site routes.
 */

import { freeForAll } from "../policy.js";
import { windowsStoreUrl, WINDOWS_STORE_ID, windowsInstallerUrl } from "./windowsStore.js";

/**
 * Every word on x0bot.com. The page is a renderer; this is the writer.
 *
 * Served by GET /v1/site, read by the landing page on load with built-in
 * fallbacks for the seconds before the answer lands. A headline change is an
 * edit here and a cache bump — the same move as every string in the app,
 * and no site deploy.
 *
 * The copy is short because the page's argument is not made in words. It
 * is made by the visitor's own sentence coming back clean.
 */
export const SITE_UI = {
  /*
   * THE HERO NAMES THE PRODUCT IN THE FIRST SECOND, THEN PROVES IT.
   *
   * This comment used to say the opposite: no headline, no eyebrow, no
   * lede, because they told a visitor in words what the picture under them
   * was already doing, and the weaker of the two was read first. The 2026
   * redesign reverses that on purpose. Its judges (three, independently)
   * found that the proof only lands once the visitor knows what they are
   * looking at, and that the old top screen made them work that out. So the
   * hero now has a category line (`apps.kind`), the owner's own product line
   * as its one h1 (`apps.title`, "Talk instead of type."), and a one-line
   * lede — and directly under them the argument this file was always built
   * around: a real sentence, said and then written clean (`lines`), with a
   * receipt of what changed and what was kept.
   *
   * What has not changed: there is no price on the page, and a string in
   * this file is a string on the page. One that renders nowhere is a claim
   * nobody can check, so it is removed rather than orphaned — which is why
   * the old hero's `cta`, `ctaHeld`, top-level `writing` and `again`, and
   * `download.hero` / `download.dev` are gone, and why `absorbs` and the
   * `hero` race words, served for a while and drawn nowhere, are drawn again.
   *
   * SENTENCE CASE EVERYWHERE, and short. A title's `human` is the part the
   * page sets in italic, the said half; a test holds it to a substring of
   * its title. Every said → written pair is a real one from `cases` or
   * `apps.fields`, never one written for the page.
   */
  // What any mic button on the page says when the browser refuses it.
  micDenied: "Mic blocked.",
  /**
   * THE SENTENCES. Every said → written pair the page shows comes from here
   * or from `apps.fields`: the hero's lines, the comb, the river's beads,
   * the phrase a plucked thread throws off. The language pages and the
   * landing pages draw their examples from the same list, by `lang`.
   *
   * Each one is a fault the quality harness already tests for, which is why
   * they can be shown rather than claimed: filler dropped with every fact
   * kept, two languages left as two languages, a misheard word repaired while
   * the amount and the name are not touched.
   */
  cases: [
    { said: "um so like can we push the call to four", wrote: "Can we push the call to four?", lang: "English" },
    { said: "the deploy is done but abhi testing baaki hai", wrote: "The deploy is done, but abhi testing baaki hai.", lang: "Hinglish" },
    { said: "हाँ वो फाइल मैंने भेज दी थी कल शाम को", wrote: "Haan, wo file maine kal shaam bhej di thi.", lang: "Hindi" },
    { said: "நான் இப்போ கிளம்பறேன் கொஞ்சம் லேட் ஆகும்", wrote: "Naan ippo kilamberen, konjam late aagum.", lang: "Tamil" },
    { said: "trensfer 2500 rupeez to ramesh tomorow", wrote: "Transfer 2500 rupees to Ramesh tomorrow.", lang: "English" },
    { said: "আমি কাল অফিসে আসব না একটু কাজ আছে", wrote: "Ami kal office-e ashbo na, ektu kaaj ache.", lang: "Bengali" },
    { said: "मी उद्या ऑफिसला येणार नाही जरा काम आहे", wrote: "Mi udya officela yenar nahi, jara kaam aahe.", lang: "Marathi" },
    { said: "eh o sea puedo llegar como a las siete", wrote: "Puedo llegar como a las siete.", lang: "Spanish" },
    { said: "నేను రేపు ఆఫీస్ కి రాను కొంచెం పని ఉంది", wrote: "Nenu repu office ki raanu, konchem pani undi.", lang: "Telugu" },
    { said: "ਮੈਂ ਕੱਲ੍ਹ ਨਹੀਂ ਆ ਸਕਦਾ ਥੋੜ੍ਹਾ ਕੰਮ ਹੈ", wrote: "Main kall nahi aa sakda, thoda kamm hai.", lang: "Punjabi" },
    { said: "હું કાલે ઓફિસે નહીં આવું થોડું કામ છે", wrote: "Hu kale office nahi aavu, thodu kaam che.", lang: "Gujarati" },
    { said: "ನಾನು ನಾಳೆ ಆಫೀಸಿಗೆ ಬರಲ್ಲ ಸ್ವಲ್ಪ ಕೆಲಸ ಇದೆ", wrote: "Naanu naale officege baralla, swalpa kelasa ide.", lang: "Kannada" },
    { said: "ഞാൻ നാളെ ഓഫീസിൽ വരില്ല കുറച്ച് ജോലി ഉണ്ട്", wrote: "Njan naale officil varilla, kurachu joli undu.", lang: "Malayalam" },
    { said: "ମୁଁ କାଲି ଅଫିସ ଆସିବି ନାହିଁ ଟିକେ କାମ ଅଛି", wrote: "Mu kali office asibi nahin, tike kama achhi.", lang: "Odia" },
    { said: "euh ben je peux arriver vers sept heures je pense", wrote: "Je peux arriver vers sept heures, je pense.", lang: "French" },
    { said: "é tipo assim eu posso chegar por volta das sete", wrote: "Eu posso chegar por volta das sete.", lang: "Portuguese" },
    { said: "ähm also ich komme so gegen sieben glaube ich", wrote: "Ich komme so gegen sieben, glaube ich.", lang: "German" },
    { said: "eh gimana ya saya bisa datang sekitar jam tujuh", wrote: "Saya bisa datang sekitar jam tujuh.", lang: "Indonesian" },
    { said: "yani sey saat yedi gibi gelebilirim heralde", wrote: "Yani saat yedi gibi gelebilirim, herhalde.", lang: "Turkish" },
    { said: "ano eto nakaka pagod pero tapos na yung report", wrote: "Nakakapagod, pero tapos na yung report.", lang: "Filipino" },
    { said: "يعني ممكن نأجل الاجتماع لبكرة الساعة أربعة", wrote: "Mumkin n2ajjel el ejtema3 la bokra el sa3a arba3a?", lang: "Arabic" },
    { said: "えっと明日の会議ちょっと遅れるかも", wrote: "Ashita no kaigi, chotto okureru kamo.", lang: "Japanese" },
    { said: "음 내일 회의 조금 늦을 것 같아요", wrote: "Naeil hoeui jogeum neujeul geot gatayo.", lang: "Korean" },
    { said: "那个 我明天可能会晚一点到", wrote: "Wo mingtian keneng hui wan yidian dao.", lang: "Chinese" },
    { said: "ну короче я завтра приду часам к семи", wrote: "Ya zavtra pridu chasam k semi.", lang: "Russian" },
    { said: "คือว่า พรุ่งนี้ขอไปสายนิดนึงนะ", wrote: "Phrungni kho pai sai nit nueng na.", lang: "Thai" },
    { said: "ờ thì mai mình đến hơi muộn xíu nha", wrote: "Mai mình đến hơi muộn một chút nhé.", lang: "Vietnamese" },
    { said: "ε λοιπόν θα έρθω κατά τις εφτά νομίζω", wrote: "Tha ertho kata tis efta, nomizo.", lang: "Greek" },
    { said: "אה אני אגיע בערך בשבע נראה לי", wrote: "Ani agia be'erech be'sheva, nir'e li.", lang: "Hebrew" },
    { said: "yaani naweza kufika saa moja hivi", wrote: "Naweza kufika saa moja hivi.", lang: "Swahili" },
    { said: "یعنی میں کل نہیں آ سکوں گا تھوڑا کام ہے", wrote: "Main kal nahi aa sakunga, thoda kaam hai.", lang: "Urdu" },
    { said: "उम म भोलि अफिस आउँदिन अलि काम छ", wrote: "Ma bholi office aaudina, ali kaam chha.", lang: "Nepali" },
    { said: "cioè tipo posso arrivare verso le sette", wrote: "Posso arrivare verso le sette.", lang: "Italian" },
    { said: "eh dus ik kan rond zeven uur komen denk ik", wrote: "Ik kan rond zeven uur komen, denk ik.", lang: "Dutch" },
    { said: "no więc mogę być koło siódmej chyba", wrote: "Mogę być koło siódmej, chyba.", lang: "Polish" },
    { said: "ну коротше я прийду десь о сьомій", wrote: "Ya pryidu des o somii.", lang: "Ukrainian" },
    { said: "یعنی فکر کنم حدود ساعت هفت برسم", wrote: "Fekr konam hodud-e saat-e haft beresam.", lang: "Persian" },
    { said: "ඒ කියන්නේ මම හෙට ඔෆිස් එන්නේ නෑ පොඩි වැඩක් තියෙනවා", wrote: "Mama heta office enne na, podi wadak thiyenawa.", lang: "Sinhala" },
  ],
  /*
   * THE SECTIONS UNDER THE HERO, in the page's order: one claim each, and
   * one proof that runs. Every claim here is one the product makes good on
   * — the three steps are the three things the quality harness tests for
   * (filler dropped, two languages kept as two, names and amounts
   * untouched); the tones are the keyboard's own (kb.tones); the desk copy
   * is what the tray app does (a double tap, then paste at the cursor);
   * "{n}" is FREE_MONTHLY_WORDS, put in by the page from the number served
   * beside this copy, so the price on the site is the price the server
   * charges.
   *
   * Nothing here claims sign-up is optional: the app has a sign-in gate.
   */
  /*
   * SMALL WORDS, EVERY ONE LOADED. Nothing here runs past a line: a claim
   * that needs a paragraph is a claim the picture beside it is not making.
   * Second person, concrete nouns, the benefit before the mechanism, and a
   * full stop where a comma would have kept going.
   */
  how: {
    title: "Talk. X0 Bot writes.",
    human: "Talk.",
    // Three steps, a title each and nothing under it.
    steps: [
      { title: "You talk." },
      // What it does that typing doesn't: the filler goes, the names stay (the FAQ's "Names and amounts stay").
      { title: "Ums out. Names kept." },
      { title: "X0 Bot writes." },
    ],
  },
  // You clean it yourself: the hero's thread, dragged across a real
  // sentence, drops the filler and leaves it written (`said` is a case).
  comb: {
    said: "um so like can we push the call to four",
    hint: "Drag the thread across it.",
    hintTouch: "Drag a finger across it.",
    key: "Clean it",
    again: "Your turn: drag it back.",
    kept: "Kept",
  },
  // Every language, as beads on the thread; a bead with a case drops it.
  // True per the facts: English letters by default, the script when asked.
  river: {
    title: "Every language you speak.",
    human: "you speak.",
    lede: "All 22 Indian languages, Hinglish, English and 50+ more. It writes in English letters, the way you text, or in your own script when you ask.",
    mix: "Two languages stay two.",
    find: "Find yours",
    // A bead with no case drops a link to its page instead: "Hindi page".
    page: "{lang} page",
    // The beads say what they are for before anyone presses one.
    tap: "Tap your language",
    // Under "Find yours" India's 23 show; the other languages wait behind one press ({count} is the page's).
    more: "{count} more languages",
    fewer: "Fewer languages",
  },
  tone: {
    title: "Same thought. Any voice.",
    human: "Any voice.",
    lede: "Say what you mean. Then choose how you want it to sound.",
    said: "hey can u send the file tonight its kinda urgent",
    tones: [
      // Six, by the brief. Casual and Excited are tones in the app,
      // Professional and Friendly are voices (personalityPresets.ts);
      // Confident and Short are the page's names for the Executive and
      // Concise voices.
      { name: "Casual", text: "Hey, can you send the file tonight? Kinda urgent." },
      { name: "Professional", text: "Could you send the file this evening? It's time-sensitive." },
      { name: "Friendly", text: "Hi! Could you send the file tonight? It's a bit urgent." },
      { name: "Confident", text: "Please send the file tonight. It's urgent." },
      { name: "Excited", text: "Can you send the file tonight? Can't wait to dig in!" },
      { name: "Short", text: "File tonight, please. Urgent." },
    ],
    // The app has 16 voices (personalityPresets.ts); the dial shows six.
    more: "16 voices in the app, Pirate and Shakespeare included.",
    // The dial's secret seventh detent, once a visitor has typed "pirate":
    // the page's own line, shown as an example of the app's Pirate voice.
    pirate: "Arr, send me the file tonight, matey. 'Tis urgent.",
  },
  /*
   * THE HERO. `kind` names the category before anything else is read,
   * `title` is the one h1 (the owner's product line), `human` is the part of
   * it set in italic, and `lede` says where the words land. The sync writes
   * all three into the page's HTML (SEO:hero), so a crawler reads them too.
   */
  apps: {
    title: "Talk instead of type.",
    human: "Talk",
    kind: "A voice keyboard and a desktop app",
    lede: "Talk in Hindi, Hinglish, any of 22 Indian languages or 50+ more. Clean words land wherever you type: WhatsApp, Gmail, ChatGPT.",
    // The correction the page can draw: a word struck through and another
    // written above it by hand. This title has none, so nothing is struck.
    cut: "", fix: "",
    // `kind` picks the drawing: a chat bubble, a mail, a note, a search bar.
    fields: [
      { kind: "message", app: "Message", text: "Can we push the call to four?" },
      { kind: "message", app: "WhatsApp", say: "मैं दस मिनट लेट हो जाऊँगा तुम ऑर्डर कर देना", text: "Main das minute late ho jaunga, tum order kar dena." },
      { kind: "mail", app: "Mail", to: "To: Priya", say: "priya ko likho deploy ho gaya hai testing abhi baaki hai", text: "Priya, deploy ho gaya hai. Testing abhi baaki hai." },
      { kind: "memo", app: "Notes", text: "Transfer 2500 rupees to Ramesh tomorrow." },
      { kind: "search", app: "Maps", say: "चाय की दुकान जो अभी खुली हो", text: "Chai ki dukaan jo abhi khuli ho" },
      { kind: "message", app: "Slack", text: "PR is up. Two files, no migrations." },
      { kind: "memo", app: "Reminders", say: "yaad dila dena amma ko nau baje se pehle call karna hai", text: "Amma ko nau baje se pehle call karna hai." },
      { kind: "message", app: "WhatsApp", say: "Marta ko bolo main das minute late hoon, spanish mein likho", text: "Marta, llego diez minutos tarde." },
      { kind: "mail", app: "Mail", to: "To: Landlord", say: "likho rent pehli tareekh ko chala jayega, translate to english", text: "The rent goes out on the first, as always." },
      { kind: "memo", app: "Notes", say: "doodh dahi do nimbu aur battery, hindi mein likho", text: "दूध, दही, दो नींबू और बैटरी।" },
      { kind: "search", app: "YouTube", text: "How to fix a squeaky door" },
      { kind: "message", app: "Message", say: "हम पाँच मिनट में पहुँच रहे हैं", text: "Hum paanch minute mein pahunch rahe hain." },
    ],
  },
  /*
   * THE HERO'S LINE. Said in handwriting, poured as dots through the thread,
   * written clean, with a receipt. "Say another." cycles them, India first.
   * Each pair is a real one — a `cases` said/wrote or an `apps.fields`
   * say/text, which a test holds it to — and `note` is the receipt, served,
   * never computed by the page, so it can never overclaim. The first is
   * always first: the page is the same for a crawler, the link card and a
   * test. The sync writes it into the HTML (SEO:line).
   */
  lines: [
    { said: "trensfer 2500 rupeez to ramesh tomorow", wrote: "Transfer 2500 rupees to Ramesh tomorrow.", note: "3 misheard words fixed · 2500 and Ramesh kept" },
    { said: "हाँ वो फाइल मैंने भेज दी थी कल शाम को", wrote: "Haan, wo file maine kal shaam bhej di thi.", note: "Said in Hindi · written in English letters" },
    { said: "the deploy is done but abhi testing baaki hai", wrote: "The deploy is done, but abhi testing baaki hai.", note: "Hinglish kept as Hinglish" },
    { said: "Marta ko bolo main das minute late hoon, spanish mein likho", wrote: "Marta, llego diez minutos tarde.", note: "Written in Spanish, because you asked" },
    { said: "நான் இப்போ கிளம்பறேன் கொஞ்சம் லேட் ஆகும்", wrote: "Naan ippo kilamberen, konjam late aagum.", note: "Said in Tamil · written in English letters" },
  ],
  /*
   * THE LEVEL-ONLY MIC. While the demo is off (DEMO_ENABLED), the page's
   * voice toys hear only how loud you are — no recording, no upload, no
   * speech recognition — and say so in these words. Amber is shown only
   * while one of them is open.
   */
  listen: {
    open: "Talk to the thread",
    note: "Only how loud. Nothing leaves this page.",
    desk: "Let it hear you",
    live: "Listening · only how loud · nothing leaves this page",
    blocked: "Mic blocked. Pluck the thread instead.",
    heard: "That's you. In the app, those words land at your cursor.",
  },
  /*
   * IT'S A KEYBOARD, SO EVERY APP. The chips are `apps.fields`; the
   * saboteur is the autocorrect film's own joke (social.html MUM): the
   * phone's autocorrect "fixes" Hinglish into nonsense, and saying it
   * instead writes it right. Local to the page; nothing is sent.
   */
  phone: {
    title: "It's a keyboard. So it's in every app.",
    human: "So it's in every app.",
    // Full Access, with its reason and what happens to the audio (facts.ts: the keyboard needs it to
    // reach the internet; the FAQ: audio is deleted once it's written), at the moment before an install.
    lede: "WhatsApp, Gmail, Instagram, ChatGPT. Switch to X0 Bot, tap once, talk. On iPhone, allow Full Access: it needs the internet to hear you. Audio is deleted once it's written.",
    privacy: "How your voice is handled",
    saboteur: {
      label: "Text Mummy",
      typed: "haan mummy aa raha hu, khana rakh do",
      fixes: { haan: "Hand", aa: "as", raha: "rash", khana: "Ghana" },
      say: "Say it instead",
      wrote: "Haan mummy, aa raha hoon. Khana rakh do.",
      after: "Autocorrect doesn't speak Hinglish. X0 Bot does.",
    },
  },
  /*
   * THE FILMS, by their media name (TAILZU-WEB/media/<id>), each with its
   * films.json title and line. Every one is drawn by social.html with no
   * third-party imagery; the ones on Apple's pictures stay off the site
   * until they are re-rendered without them.
   */
  films: {
    title: "Watch it write.",
    human: "write.",
    // Drawn by social.html (a canvas, not screen recordings), so the line says what they show, no more.
    lede: "Short films of what it writes.",
    sound: "Sound",
    items: [
      { id: "keyless", title: "Keyless", line: "“It's a keyboard.” Then the keys turn to dust and leave the mic." },
      { id: "said-written", title: "Said, then written", line: "Filler gone, misheard words fixed with the amount and the name untouched, Hinglish kept as Hinglish." },
      { id: "spanish", title: "Hinglish in, Spanish out", line: "Say it with “spanish mein likho” on the end and Marta reads Spanish." },
      { id: "to-him", title: "To him", line: "A message dictated with its own instructions on the end, written sweet." },
      { id: "tones", title: "Same words, your tone", line: "One sentence said once, written six ways, each in a world of its own." },
    ],
  },
  // The typing race: beat the said time from the Typed vs said film (2.6 s)
  // typing the comb's sentence. Nothing is stored.
  race: {
    prompt: "Think you're quick? Type this. Beat 2.6 seconds.",
    line: "Can we push the call to four?",
    you: "You",
    said: "Said",
    note: "Nobody wins this. That's the point.",
    placeholder: "type it here…",
  },
  desk: {
    title: "Your keyboard just learned another trick.",
    human: "another trick.",
    lede: "Your words appear at the cursor. No copy. No paste.",
    // The tray app's way in (desktop/main.js, `tap` on by default): a
    // double-tap on Ctrl, or on Alt. The chord and F9 are fallbacks and are
    // not what the page shows. Two keys drawn is the gesture; `join` is
    // what goes between them, and for a double-tap nothing does.
    keys: ["Ctrl", "Ctrl"],
    join: "",
    // Shared by the hero's hint and this section: the app's own pill runs
    // in the page (pill.js) on a stand-in window.
    try: "Tap Ctrl twice. Try the desktop pill here.",
    toast: "In the app, this lands at your cursor.",
    stage: "A stand-in app",
    // Phones have no Ctrl: the keycap that runs the pill says so.
    tryTouch: "Try the pill",
    // The rest pill's own hint, on a desk, after the stage has run.
    hint: "Tap Ctrl twice to talk",
    // On a phone the installers are for later: send the link to the laptop instead.
    share: "Send this to my laptop",
    shareText: "X0 Bot for my laptop",
    copied: "Link copied. Open it on your laptop.",
    // Meeting notes (released): Ctrl+Alt+N, ⌘⌥N on a Mac. The lines are the
    // Bleeped film's real meeting (AMI ES2002a, CC BY 4.0: the credit is
    // required wherever they show), small talk first, then the point.
    notes: "In a call? Ctrl+Alt+N (⌘⌥N on a Mac) takes the notes. It keeps what mattered, not the small talk.",
    kept: "The point, kept.",
    point: "Sells for €25. Costs no more than €12.50.",
    credit: "Meeting audio: AMI Meeting Corpus ES2002a, CC BY 4.0.",
    meeting: [
      "Is that a whale?",
      "My favourite animal is like a beagle.",
      "When planet of the apes becomes real.",
      "He looks more like a pig, actually.",
      "He chases his tail.",
      "Is he aware that it's his own tail?",
      "We're gonna be selling this remote control for twenty-five euro, and we don't want it to cost any more than twelve fifty.",
      "Um, can we just go over that again?",
      "Oh gosh, I should be writing all this down.",
    ],
  },
  /*
   * THE FINALE. The biggest pill splits edge to edge; "Not now" snaps it
   * shut with grace; a line exists only once the visitor has spoken (to the
   * level-only mic) or typed "hi". Still no price and no lede: the free line
   * under the title is `download.free`, taken from the FAQ's own answer.
   */
  free: {
    title: "Why type it? Say it.",
    human: "Say it.",
    no: "Not now",
    fine: "Fine. It'll be here.",
    qr: "On your phone? Scan.",
    say: "Say something to Blip",
    type: "Or type hi",
    heard: "You just talked to a website. Imagine what you'd say to WhatsApp.",
    // The same secret, earned by typing "hi": it says what happened.
    typed: "You just typed hi to a website. Imagine saying it.",
  },
  /*
   * THE MACHINES. Say it rough, and a clean prompt lands in the box of
   * whichever machine you talk to. The page plays it: the said line runs
   * through a pill like the keyboard's own bar, then the written line types
   * into a chat window, under a tab for each of the machines named here.
   * The two lines are a real cleanup — structure restored, nothing added.
   */
  llm: {
    title: "AI is already conversational.",
    lede: "Your computer should be too. Say it once.",
    targets: ["ChatGPT", "Claude", "Grok"],
    more: "and more",
    tag: "New chat",
    // One prompt per machine, in the order of `targets`: what was said
    // roughly, and the prompt that lands in that machine's box. The page
    // plays one, then moves to the next tab. `said`/`wrote` are the first,
    // for a page that only knows one.
    prompts: [
      { said: "okay so um explain black holes but like to a golden retriever", wrote: "Explain black holes to a golden retriever." },
      { said: "uh write a breakup letter from my alarm clock to me, dramatic but polite", wrote: "Write a dramatic but polite breakup letter from my alarm clock to me." },
      { said: "so um if cats ran the stock market what would crash first and why", wrote: "If cats ran the stock market, what would crash first, and why?" },
    ],
    said: "okay so um explain black holes but like to a golden retriever",
    wrote: "Explain black holes to a golden retriever.",
    // What it does in a chat box, and what it never does (the facts say so).
    note: "It writes the prompt. Never the answer.",
  },
  /*
   * FOR DEVELOPERS. The same picture in an editor: something said, and the
   * change landing at the cursor as a clean line. The tray app pastes into
   * any window, an editor included, so this is what it does and not a
   * promise. The file, the app and the language are set dressing.
   */
  dev: {
    title: "Your hands don't have to be the bottleneck.",
    lede: "X0 Bot puts the instruction where it belongs.",
    app: "Cursor",
    file: "auth.ts",
    lang: "TypeScript",
    said: "um find the auth bug but like keep the API the same and add tests for when it fails",
    wrote: "// Find the authentication bug, keep the API unchanged, and add tests for the failure case.",
  },
  /*
   * ASK, WHILE IT IS UNRELEASED. Served always, shown only when the
   * top-level `ask` flag of /v1/site is "soon" or "live" (ASK_SITE, or a
   * console rule on /ask). Off, the page keeps an empty #ask shell and
   * paints none of these, so no crawler reads a claim about a feature
   * nobody can download yet; nothing about Ask goes into the FAQ, the
   * structured data or llms.txt until it ships. `runs` are the scripted
   * scenes the preview plays on a stand-in app (demo/drive.js).
   */
  ask: {
    soon: "Coming to the desktop app",
    live: "New in the desktop app",
    title: "Ask about anything on your screen.",
    human: "anything on your screen.",
    lede: "Tap Alt twice and ask. It points at the right button, explains out loud, and draws on your screen while it explains. Small jobs wait for your Do it.",
    note: "Dictation is in the desktop app today. Ask arrives in an update.",
    preview: "A preview, running the app's own code on a stand-in app.",
    play: "Play it here",
    egg: "Ask is coming to the desktop app. Here's a preview.",
    runs: [
      { id: "picture", label: "Explain this triangle" },
      { id: "export", label: "Where's export?" },
      { id: "send", label: "Tell #design the mockups are ready" },
    ],
  },
  faq: {
    title: "Asked, answered.",
    // Eight, each answered in a breath (a test holds both numbers). Every
    // answer is something the product does: there is no offline mode, and
    // audio is kept only with session history on (the privacy policy, 1.2).
    //
    // EACH ANSWER STANDS ALONE. Answer engines quote one answer, never the
    // one above it, and these are also the page's FAQPage data — so "Most of
    // the world's" became the languages it means, and the page now says in
    // its own words what the product is.
    items: [
      { q: "What is X0 Bot?", a: "A voice keyboard. Talk in any language, send clean text." },
      { q: "Does it work in WhatsApp?", a: "Yes. It's a keyboard, so every app." },
      { q: "Which languages?", a: "All 22 Indian languages, Hinglish, English and 50+ more." },
      { q: "Hinglish?", a: "Native. Two languages stay two." },
      { q: "Does it change what I said?", a: "It cleans. It never rewrites. Names and amounts stay." },
      { q: "Is it free?", a: "{n} words a month, free. Then upgrade.", aFree: "Yes. Every word, free. No limit." },
      { q: "Is my voice stored?", a: "Not by default. Audio is deleted once it's written." },
      { q: "Offline?", a: "No. It needs a connection to hear you." },
    ],
  },
  /* THE HERO'S SMALL WORDS. `said`/`typed` and `taps`/`press` caption the
     Typed vs said film ("Typed · 8.8 s · 36 taps" against "Said · 2.6 s ·
     1 press"). `again` is "Say another.", which cycles `lines`. `invite`,
     `listening` and `writing` are the say-it-yourself mic's states, shown
     only while the live demo is on (DEMO_ENABLED). No `title`: the h1 is
     `apps.title`. */
  hero: {
    said: "Said",
    typed: "Typed",
    taps: "taps",
    press: "press",
    invite: "Press. Say anything.",
    listening: "Listening",
    writing: "Writing",
    again: "Say another."
  },
  absorb: "Heard.",
  /*
   * THE BEAT, ONE WORD AT A TIME. Over the hero's line, one word is lit as
   * the line moves through it — heard as it is said, meant as the mess is
   * named, written as the dots land, sent as the receipt types in.
   * `absorb` above is the first of them, kept for a page that only knows
   * one. Two words each at most; a test holds it.
   */
  absorbs: ["Heard.", "Meant.", "Written.", "Sent."],
  /*
   * THE BUTTON THAT KNOWS THE VISITOR. The page sends a phone to its store
   * and a desk to its installer (or to /download while there is none), and
   * names the platform on the button, so nobody is surprised by a .dmg.
   * `get` is for anything it cannot tell (ChromeOS, a TV, a bot). `short`
   * and `shortTouch` are the small pill in the header. `free` is the line
   * under the button, the FAQ's own answer to "Is it free?" in brief (a
   * test holds it to that answer): `free` while Tailzu is free for all, and
   * `freeCapped` — the allowance, "{n}" put in by the page — when it is not.
   * siteCopy() serves the one that is true as `free`, the way the FAQ serves
   * `aFree`, so flipping FREE_FOR_ALL can never leave "every word" under a
   * button while the server counts words. `starting` / `started` /
   * `startedNote` are an installer's feedback, since a download has no event
   * to wait for. The store links live in `stores` so they can change without
   * a site deploy.
   */
  download: {
    get: "Get X0 Bot",
    ios: "Get it on iPhone",
    android: "Get it on Android",
    win: "Download for Windows",
    mac: "Download for Mac",
    linux: "Download for Linux",
    short: "Download",
    shortTouch: "Get it",
    free: "Every word, free.",
    freeCapped: "{n} words a month, free.",
    other: "Other devices",
    starting: "Starting",
    started: "Check your downloads",
    startedNote: "Download started. Open {file} to install.",
  },
  stores: {
    ios: "https://apps.apple.com/app/id6784811357",
    android: "https://play.google.com/store/apps/details?id=com.tulmi.app",
    // "" until WINDOWS_STORE_ID is set; every reader treats "" as no listing.
    // The listing is what search engines and llms.txt cite; every download
    // BUTTON uses windowsInstaller, the certified build's direct download.
    windows: windowsStoreUrl(WINDOWS_STORE_ID),
    windowsInstaller: windowsInstallerUrl(WINDOWS_STORE_ID),
  },
  /*
   * BLIP, IN HANDWRITING. The app's own character (blip.js) lives on the
   * page and says these: hello in Indian languages when clicked, a line per
   * poke, what it says to the typing eggs, and goodbye. In Blip's voice and
   * the owner's to tune; a test holds every line to twelve words (the
   * pirate `lede` is not Blip's line but the hero's, swapped for a moment).
   */
  blip: {
    hello: ["Namaste.", "Vanakkam.", "Nomoshkar.", "Sat Sri Akal.", "Kem cho?", "Namaskara.", "Namaskaram.", "Khamma ghani."],
    pokes: ["Hey.", "That tickles.", "I'm not a button.", "Fine. I'll watch from over here.", "OK, OK. Tap Ctrl twice."],
    pokeTouch: "OK, OK. Get the keyboard.",
    hint: "Go on, pluck it",
    hintTouch: "Drag a finger across it",
    typed6: "6 taps. You could've just said it.",
    typed24: "Still typing? Tap Ctrl twice.",
    me: "That's me.",
    copy: "Next time, just say it.",
    knot: "That's the end of the thread.",
    bye: "Bye. Tap Ctrl twice sometime.",
    byeTouch: "Bye. Talk soon.",
    pirate: {
      tag: "Tone: pirate",
      lede: "Talk in Hindi, Hinglish or 70-odd tongues more, matey. Clean words land wherever ye type: WhatsApp, Gmail, ChatGPT.",
      toast: "Arr. That's a voice. There are 16.",
    },
  },
  // The page's own furniture: the header's nav and switch, the film
  // controls, the skip link and the footer. Platform names are words, never
  // logos.
  ui: {
    films: "Films",
    languages: "Languages",
    ask: "Ask",
    soon: "Soon",
    questions: "Questions",
    calm: "Calm",
    pause: "Pause the film",
    play: "Play the film",
    prev: "Previous film",
    next: "Next film",
    top: "Back to top",
    skip: "Skip to the page",
    heroFilm: "An X0 Bot film · Heard · speech in 22 scripts",
    platforms: ["iPhone", "Android", "Windows", "Mac", "Linux"],
    made: "Made by Xooteq Lab.",
    // Every film is an iPhone or a Mac; the keyboard on Android does the same.
    android: "Shown on iPhone. Same on Android.",
    // The spine's knot-beads: a number and a name per section, as you pass it.
    spine: { how: "How it works", river: "Languages", apps: "Every app", films: "Films", tone: "Tone", desk: "Desktop", llm: "AI", dev: "Code", ask: "Ask", questions: "Questions", free: "Free" },
  },
} as const;

/**
 * The site's copy as it should read right now. While Tailzu is free
 * (FREE_FOR_ALL), an answer with a free version (`aFree`) says that instead,
 * so the page, its FAQ data and the served copy never quote a price. The
 * free line under the buttons follows the same answer: "Every word, free."
 * only while that is what the FAQ says, the allowance otherwise.
 */
export function siteCopy(): Omit<typeof SITE_UI, "faq" | "download"> & {
  faq: { title: string; items: Array<{ q: string; a: string }> };
  download: Omit<typeof SITE_UI.download, "free" | "freeCapped"> & { free: string };
} {
  const free = freeForAll();
  const items = SITE_UI.faq.items.map((it) =>
    (free && "aFree" in it && typeof it.aFree === "string" ? { q: it.q, a: it.aFree } : { q: it.q, a: it.a }));
  const { freeCapped, ...download } = SITE_UI.download;
  return {
    ...SITE_UI,
    faq: { title: SITE_UI.faq.title, items },
    download: { ...download, free: free ? download.free : freeCapped },
  };
}
