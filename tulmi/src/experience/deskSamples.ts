/**
 * ONE SENTENCE, SAID FOUR WAYS, WRITTEN IN EVERY VOICE.
 *
 * The desk's Voices page shows what each voice does to the same words, and
 * the words change with the kind of writing — a chat, a work update, an email,
 * anything else — because a voice that suits one can be wrong for another and
 * that is the whole reason to see them side by side.
 *
 * Written by hand, the way the site's tone examples are: these are
 * illustrations of each voice's register, not recorded output. Keyed by
 * preset id (personalityPresets.ts); a voice missing here shows its tagline.
 */
export type DeskContext = "chats" | "work" | "email" | "other";

export const DESK_CONTEXTS: Array<{ id: DeskContext; label: string; said: string }> = [
  { id: "chats", label: "Chats", said: "haan bhai kal milte hain paanch baje" },
  { id: "work", label: "Work", said: "the deck is done just need one more pass on the numbers" },
  { id: "email", label: "Email", said: "hi priya great talking today looking forward to the next one" },
  { id: "other", label: "Other", said: "send the file tonight its urgent" },
];

export const DESK_SAMPLES: Record<string, Record<DeskContext, string>> = {
  signature: {
    chats: "Haan bhai, kal milte hain paanch baje.",
    work: "The deck is done. It just needs one more pass on the numbers.",
    email: "Hi Priya,\n\nGreat talking today. Looking forward to the next one.",
    other: "Send the file tonight, it's urgent.",
  },
  professional: {
    chats: "Haan, kal shaam paanch baje milte hain.",
    work: "The deck is complete. I will do a final review of the numbers today.",
    email: "Hi Priya,\n\nThank you for your time today. I look forward to our next conversation.",
    other: "Could you please send the file this evening? It is time-sensitive.",
  },
  friendly: {
    chats: "Haan bhai! Kal paanch baje milte hain.",
    work: "Deck's done! Just one more look at the numbers.",
    email: "Hey Priya!\n\nLoved chatting today. Can't wait for the next one.",
    other: "Hey, could you send the file tonight? It's kind of urgent.",
  },
  witty: {
    chats: "Kal paanch baje. Be there, or be rescheduled.",
    work: "The deck is done. The numbers want one more interrogation.",
    email: "Hi Priya,\n\nToday set a high bar. The next one has work to do.",
    other: "The file, tonight, please. Urgency has entered the chat.",
  },
  concise: {
    chats: "Kal, paanch baje.",
    work: "Deck done. One more pass on the numbers.",
    email: "Hi Priya,\n\nGreat call. Talk soon.",
    other: "File tonight, please. Urgent.",
  },
  gentle: {
    chats: "Haan, kal paanch baje milte hain. Take care till then.",
    work: "The deck is ready. I'd like one more careful pass on the numbers.",
    email: "Hi Priya,\n\nIt was lovely talking with you today. Looking forward to next time.",
    other: "When you can tonight, could you send the file? It's a little urgent.",
  },
  playful: {
    chats: "Kal paanch baje, pakka. Late mat hona!",
    work: "Deck: done. Numbers: one more round, then we're free.",
    email: "Hi Priya!\n\nToday was fun. Round two soon?",
    other: "File tonight pls, it's urgent-urgent.",
  },
  romantic: {
    chats: "Kal paanch baje. Counting the hours already.",
    work: "The deck is finished. The numbers deserve one last look.",
    email: "Priya,\n\nToday was wonderful. I'm already looking forward to the next one.",
    other: "Send it tonight? It matters.",
  },
  "concise-boss": {
    chats: "Confirmed: kal, 5 PM.",
    work: "Deck complete. Final numbers check today.",
    email: "Priya,\n\nGood discussion today. Let's schedule the follow-up.",
    other: "Need the file tonight. Priority.",
  },
  explainer: {
    chats: "Plan: kal paanch baje milte hain. Kuch badla toh bata dunga.",
    work: "The deck is done. Next step: one more pass on the numbers to confirm them.",
    email: "Hi Priya,\n\nThanks for today's conversation. I'll share next steps before we meet again.",
    other: "Please send the file tonight. It's urgent, so tonight is the deadline.",
  },
  excited: {
    chats: "KAL PAANCH BAJE! Let's go!",
    work: "Deck is DONE! One last pass on the numbers and we ship!",
    email: "Priya!\n\nWhat a great talk today! Bring on the next one!",
    other: "Send the file TONIGHT! It's urgent!",
  },
  poetic: {
    chats: "Kal, jab ghadi paanch ki taraf jhukegi, milenge.",
    work: "The deck is whole; the numbers ask for one more reading.",
    email: "Priya,\n\nToday's words stayed with me. Until the next ones.",
    other: "Before the night closes, send the file. Time is short.",
  },
  bard: {
    chats: "Aye, on the morrow at the fifth hour we meet.",
    work: "The deck is wrought; the numbers crave but one more glance.",
    email: "Good Priya,\n\nThy converse this day was sweet. I await the next.",
    other: "Prithee, send the file ere night doth fall. 'Tis most urgent.",
  },
  pirate: {
    chats: "Arr, tomorrow at five bells, matey.",
    work: "The deck be done, cap'n. One more look at the numbers.",
    email: "Ahoy Priya,\n\nFine parley today. Till the next one.",
    other: "Arr, send the file tonight, matey. It be urgent.",
  },
  trailer: {
    chats: "Tomorrow. Five o'clock. Two friends. One meeting.",
    work: "One deck. One last pass. The numbers decide everything.",
    email: "Priya.\n\nOne conversation changed everything. The sequel is coming.",
    other: "One file. One night. And time is running out.",
  },
  noir: {
    chats: "Tomorrow. Five. The kind of meeting you don't miss.",
    work: "The deck was done. The numbers still had something to say.",
    email: "Priya,\n\nWe talked. It was good. The next one will be better.",
    other: "The file. Tonight. In this town, urgent means yesterday.",
  },
};

/** Each voice's room: the colour world its card is drawn in (app.html d-w-*). */
export const DESK_ROOMS: Record<string, string> = {
  signature: "d-w-zu", concise: "d-w-zu", explainer: "d-w-zu", gentle: "d-w-zu",
  professional: "d-w-indigo", "concise-boss": "d-w-indigo",
  friendly: "d-w-saffron", excited: "d-w-saffron",
  playful: "d-w-teal", witty: "d-w-teal", pirate: "d-w-teal",
  romantic: "d-w-rose", poetic: "d-w-rose",
  bard: "d-w-paper", noir: "d-w-noir", trailer: "d-w-night",
};
