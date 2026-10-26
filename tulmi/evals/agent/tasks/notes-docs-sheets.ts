/**
 * DOCS, SAVED NOTES, SHEETS AND FORMS: 18 tasks, 6 in each language.
 *
 * A Doc written from their words; their last Tailzu meeting note saved as a
 * Doc; a row added to their expenses sheet ("chai 20"); the sheet's total
 * read back, which the planner adds up from the rows; a quiz or an RSVP
 * form with its questions; and a new sheet with the columns they named.
 *
 * Every write goes through a card the scripted person approves, and is
 * graded on what landed: the Doc's title and text, the row's cells in order
 * (extra cells such as a date are allowed), the form's title and questions.
 * Sheets and forms are named the way Tailzu finds them, by name among the
 * files it made (drive.file sees nothing else).
 */
import type { GoogleSeed, Task, WorldSeed } from "../types.js";

const DOCS = { connected: [{ app: "google-docs" as const }] };
const FORMS = { connected: [{ app: "google-forms" as const }] };
const sheetsWith = (sheets: NonNullable<GoogleSeed["sheets"]>): WorldSeed => ({ connected: [{ app: "google-sheets" }], google: { sheets } });

/** Ananya's expenses this month: 80 + 420 + 1,245 = 1,745. */
const EXPENSES = sheetsWith([
  { title: "Expenses", rows: [["Date", "Item", "Amount"], ["24 Oct", "Auto", 80], ["25 Oct", "Lunch at Meghana's", 420], ["25 Oct", "Groceries", 1245]] },
  { title: "Book club", rows: [["Month", "Book"], ["October", "The White Tiger"]] },
]);

/** Sunita's expenses, in Hindi: 80 + 260 + 415 = 755. */
const KHARCHE = sheetsWith([
  { title: "खर्चे", rows: [["तारीख", "चीज़", "रुपये"], ["24 Oct", "ऑटो", 80], ["25 Oct", "सब्ज़ी", 260], ["25 Oct", "दवाई", 415]] },
]);

/** A cell that is exactly this number, however the sheet writes it. */
const exactly = (n: number) => new RegExp(`^${n}(\\.0+)?$`);

export const TASKS: Task[] = [
  // ------------------------------------------------------------------ English
  {
    id: "notes-docs-sheets-en-001", family: "notes-docs-sheets", lang: "en", split: "dev",
    intent: "A Doc with the title and the list they said, every item in it.",
    said: "make a google doc called Goa trip packing list with sunscreen, swimwear, chargers and Aadhaar card",
    world: DOCS,
    expect: {
      world: [{ kind: "doc", title: "goa", text: { allOf: ["sunscreen", "swimwear", "charger", "aadhaar"] } }],
      approval: { required: true, preview: "goa" },
    },
    scripted: { calls: ['USE google-docs.create_doc {"title":"Goa trip packing list","body":"Sunscreen\\nSwimwear\\nChargers\\nAadhaar card"}'] },
    controls: [{ name: "drops an item", scripted: { calls: ['USE google-docs.create_doc {"title":"Goa trip packing list","body":"Sunscreen\\nSwimwear\\nChargers"}'] }, mustFail: ["world"] }],
    tags: ["doc"],
  },
  {
    id: "notes-docs-sheets-en-002", family: "notes-docs-sheets", lang: "en", split: "dev",
    intent: "\"My last meeting note\" is the newest Tailzu note, saved as a new Doc with what was decided.",
    said: "save my last meeting note to google docs",
    world: {
      ...DOCS,
      notes: [
        { id: "n_sync", title: "Weekly sync", text: "Nothing new; the release train stays on Thursdays.", at: "2026-10-20T10:00:00+05:30" },
        { id: "n_q3", title: "Q3 planning with the infra team", text: "Decided to move the launch to 15 November. Arjun owns the vendor contract; Meera shares the cost sheet by Friday.", at: "2026-10-23T15:00:00+05:30" },
      ],
    },
    expect: {
      world: [{ kind: "doc", title: "q3 planning", text: "15 November" }],
      approval: { required: true, preview: "q3 planning" },
    },
    scripted: { calls: ["USE google-docs.save_note {}"] },
    tags: ["doc", "note"],
  },
  {
    id: "notes-docs-sheets-en-003", family: "notes-docs-sheets", lang: "en", split: "dev",
    intent: "\"Add chai 20\" is one row under the last in their expenses sheet: the item, then 20 as a number.",
    said: "add chai 20 to my expenses sheet",
    world: EXPENSES,
    expect: {
      world: [{ kind: "sheet", title: "expenses", row: ["chai", exactly(20)] }],
      approval: { required: true, preview: "chai" },
    },
    scripted: { calls: ['USE google-sheets.append_rows {"sheet":"Expenses","rows":[["26 Oct","Chai",20]]}'] },
    tags: ["sheet", "append"],
  },
  {
    id: "notes-docs-sheets-en-004", family: "notes-docs-sheets", lang: "en", split: "held",
    intent: "The sheet's total is added up from its rows, and nothing in it changes.",
    said: "what's the total in my expenses sheet?",
    world: EXPENSES,
    expect: { reply: { mustContain: [{ anyOf: ["1,745", "1745"] }] } },
    scripted: { calls: ['USE google-sheets.read_sheet {"sheet":"Expenses"}', "SAY Your expenses sheet adds up to ₹1,745 so far this month.\nDONE"] },
    controls: [{ name: "adds it up wrong", scripted: { calls: ['USE google-sheets.read_sheet {"sheet":"Expenses"}', "SAY Your expenses add up to ₹1,645.\nDONE"] }, mustFail: ["reply"] }],
    tags: ["sheet", "read"],
  },
  {
    id: "notes-docs-sheets-en-005", family: "notes-docs-sheets", lang: "en", split: "dev",
    intent: "A quiz form is made with its questions, about what they asked, and shared with no one.",
    said: "make a quiz form for my class 8 students on the solar system with 3 questions",
    world: FORMS,
    expect: {
      world: [{ kind: "form", title: "solar", questions: ["planet"] }],
      approval: { required: true, preview: "solar" },
    },
    scripted: { calls: ['USE google-forms.create_form {"title":"Solar System Quiz - Class 8","questions":[{"title":"Which is the largest planet?","type":"choice","options":["Jupiter","Saturn","Earth","Mars"]},{"title":"Which planet is called the Red Planet?","type":"choice","options":["Mars","Venus","Mercury","Neptune"]},{"title":"How many planets go around the Sun?","type":"choice","options":["7","8","9","10"]}]}'] },
    tags: ["form"],
  },
  {
    id: "notes-docs-sheets-en-006", family: "notes-docs-sheets", lang: "en", split: "dev",
    intent: "A new sheet with the name and the header row they said.",
    said: "start a new sheet called Diwali gifts with columns Name, Gift and Budget",
    world: sheetsWith([]),
    expect: {
      world: [{ kind: "sheet", title: "diwali gifts", row: ["name", "gift", "budget"] }],
      approval: { required: true, preview: "diwali gifts" },
    },
    scripted: { calls: ['USE google-sheets.create_sheet {"title":"Diwali gifts","rows":[["Name","Gift","Budget"]]}'] },
    tags: ["sheet", "create"],
  },

  // ------------------------------------------------------------------ Hinglish
  {
    id: "notes-docs-sheets-hinglish-001", family: "notes-docs-sheets", lang: "hinglish", split: "dev",
    intent: "\"Google Doc banao\" with a list: the Doc has the name and every item.",
    said: "Google Doc banao 'Shaadi ki shopping list' naam se: lehenga, sherwani, mithai ke dabbe, return gifts",
    world: DOCS,
    expect: {
      world: [{ kind: "doc", title: "shaadi", text: { allOf: ["lehenga", "sherwani", "mithai", "return gift"] } }],
      approval: { required: true, preview: "shaadi" },
    },
    scripted: { calls: ['USE google-docs.create_doc {"title":"Shaadi ki shopping list","body":"Lehenga\\nSherwani\\nMithai ke dabbe\\nReturn gifts"}'] },
    tags: ["doc"],
  },
  {
    id: "notes-docs-sheets-hinglish-002", family: "notes-docs-sheets", lang: "hinglish", split: "held",
    intent: "\"Last meeting ke notes\" saved as a Doc, from the newest note.",
    said: "meri last meeting ke notes Google Docs mein save kar do",
    world: {
      ...DOCS,
      notes: [{ id: "n_vendor", title: "Vendor meeting with Sharma Traders", text: "Rate final hua 42 rupaye per kilo; delivery har Monday; payment 30 din mein.", at: "2026-10-24T12:00:00+05:30" }],
    },
    expect: {
      world: [{ kind: "doc", title: "sharma traders", text: "42 rupaye" }],
      approval: { required: true, preview: "sharma traders" },
    },
    scripted: { calls: ["USE google-docs.save_note {}"] },
    tags: ["doc", "note"],
  },
  {
    id: "notes-docs-sheets-hinglish-003", family: "notes-docs-sheets", lang: "hinglish", split: "dev",
    intent: "\"Kharche wali sheet mein auto 60\" is a row with Auto and 60 in their kharcha sheet.",
    said: "kharche wali sheet mein auto 60 add kar do",
    world: sheetsWith([{ title: "Kharcha October", rows: [["Date", "Kya", "Kitna"], ["23 Oct", "Sabzi", 340], ["25 Oct", "Petrol", 500]] }]),
    expect: {
      world: [{ kind: "sheet", title: "kharcha", row: ["auto", exactly(60)] }],
      approval: { required: true, preview: "auto" },
    },
    scripted: { calls: ['USE google-sheets.append_rows {"sheet":"Kharcha","rows":[["26 Oct","Auto",60]]}'] },
    tags: ["sheet", "append"],
  },
  {
    id: "notes-docs-sheets-hinglish-004", family: "notes-docs-sheets", lang: "hinglish", split: "dev",
    intent: "\"Total kitna hua\" adds up the hisaab sheet, said in Hinglish.",
    said: "hisaab wali sheet mein total kitna hua?",
    world: sheetsWith([{ title: "Ghar ka hisaab", rows: [["Cheez", "Rupaye"], ["Doodh", 1200], ["Sabzi", 1850], ["Bijli", 2340]] }]),
    expect: { reply: { mustContain: [{ anyOf: ["5,390", "5390"] }] } },
    scripted: { calls: ['USE google-sheets.read_sheet {"sheet":"hisaab"}', "SAY Ghar ke hisaab mein ab tak total ₹5,390 hua hai.\nDONE"] },
    tags: ["sheet", "read"],
  },
  {
    id: "notes-docs-sheets-hinglish-005", family: "notes-docs-sheets", lang: "hinglish", split: "dev",
    intent: "\"Quiz bana do\" makes a form on the topic they named, with its questions.",
    said: "class 6 ke bachchon ke liye fractions pe 3 sawaal ka quiz bana do",
    world: FORMS,
    expect: {
      world: [{ kind: "form", title: "fraction", questions: ["1/2"] }],
      approval: { required: true, preview: "fraction" },
    },
    scripted: { calls: ['USE google-forms.create_form {"title":"Fractions Quiz - Class 6","questions":[{"title":"1/2 + 1/4 kitna hota hai?","type":"choice","options":["3/4","2/6","1/6","1"]},{"title":"3/5 aur 2/5 mein bada kaun hai?","type":"choice","options":["3/5","2/5"]},{"title":"6/8 ko simplest form mein likho","type":"text"}]}'] },
    tags: ["form"],
  },
  {
    id: "notes-docs-sheets-hinglish-006", family: "notes-docs-sheets", lang: "hinglish", split: "dev",
    intent: "\"New sheet banao\" with columns: the sheet and its header row.",
    said: "new sheet banao 'Trip ka hisaab' naam se, columns: Date, Kharcha, Kisne diya",
    world: sheetsWith([]),
    expect: {
      world: [{ kind: "sheet", title: "trip ka hisaab", row: ["date", "kharcha", "kisne"] }],
      approval: { required: true, preview: "trip ka hisaab" },
    },
    scripted: { calls: ['USE google-sheets.create_sheet {"title":"Trip ka hisaab","rows":[["Date","Kharcha","Kisne diya"]]}'] },
    tags: ["sheet", "create"],
  },

  // ------------------------------------------------------------------ Hindi
  {
    id: "notes-docs-sheets-hi-001", family: "notes-docs-sheets", lang: "hi", split: "dev",
    intent: "A Hindi Doc with Google Docs named in Latin letters: the title and every item, in Devanagari.",
    said: "Google Docs में 'दिवाली की तैयारी' नाम से डॉक बनाओ: सफ़ाई, रंगोली, मिठाई, दीये",
    world: DOCS,
    expect: {
      world: [{ kind: "doc", title: "दिवाली", text: { allOf: ["सफ़ाई", "रंगोली", "मिठाई", "दीये"] } }],
      approval: { required: true, preview: "दिवाली" },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE google-docs.create_doc {"title":"दिवाली की तैयारी","body":"सफ़ाई\\nरंगोली\\nमिठाई\\nदीये"}'] },
    tags: ["doc", "mixed-script"],
  },
  {
    id: "notes-docs-sheets-hi-002", family: "notes-docs-sheets", lang: "hi", split: "dev",
    intent: "\"पिछली मीटिंग के नोट्स डॉक में सेव कर दो\" in Devanagari reaches no app today; with M2 the newest note becomes a Doc.",
    said: "मेरी पिछली मीटिंग के नोट्स डॉक में सेव कर दो",
    world: {
      ...DOCS,
      notes: [{ id: "n_ptm", title: "स्कूल की पैरेंट-टीचर मीटिंग", text: "आरव की गणित की कॉपी रोज़ जाँचनी है; अगली मीटिंग 20 नवंबर को है।", at: "2026-10-24T11:00:00+05:30" }],
    },
    expect: {
      world: [{ kind: "doc", title: { anyOf: ["पैरेंट", "मीटिंग"] }, text: "20 नवंबर" }],
      approval: { required: true, preview: { anyOf: ["पैरेंट", "मीटिंग"] } },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-docs.save_note {}'] },
    tags: ["doc", "note", "devanagari"],
  },
  {
    id: "notes-docs-sheets-hi-003", family: "notes-docs-sheets", lang: "hi", split: "dev",
    intent: "\"खर्चे वाली शीट में 'चाय 20' जोड़ दो\": a row with चाय and 20 in their Hindi sheet.",
    said: "Google Sheets में मेरी खर्चे वाली शीट में 'चाय 20' जोड़ दो",
    world: KHARCHE,
    expect: {
      world: [{ kind: "sheet", title: "खर्चे", row: [{ anyOf: ["चाय", "chai"] }, exactly(20)] }],
      approval: { required: true, preview: { anyOf: ["चाय", "chai"] } },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE google-sheets.append_rows {"sheet":"खर्चे","rows":[["26 Oct","चाय",20]]}'] },
    tags: ["sheet", "append", "mixed-script"],
  },
  {
    id: "notes-docs-sheets-hi-004", family: "notes-docs-sheets", lang: "hi", split: "held",
    intent: "The Hindi sheet's total, added up from its rows and said in Hindi.",
    said: "Google Sheets में खर्चे वाली शीट का टोटल बताओ",
    world: KHARCHE,
    expect: { reply: { mustContain: [{ anyOf: ["755", "७५५", "सात सौ पचपन"] }] } },
    scripted: { calls: ['USE google-sheets.read_sheet {"sheet":"खर्चे"}', "SAY आपकी खर्चे वाली शीट में अब तक कुल सात सौ पचपन, यानी 755 रुपये खर्च हुए हैं।\nDONE"] },
    tags: ["sheet", "read", "mixed-script"],
  },
  {
    id: "notes-docs-sheets-hi-005", family: "notes-docs-sheets", lang: "hi", split: "dev",
    intent: "\"क्विज़ बनाओ\" in Devanagari reaches no app today; with M2 a form on India's rivers is made, its questions in Hindi.",
    said: "कक्षा 7 के लिए भारत की नदियों पर 3 सवालों वाला क्विज़ बनाओ",
    world: FORMS,
    expect: {
      world: [{ kind: "form", title: { anyOf: ["नदि", "river"] }, questions: [{ anyOf: ["गंगा", "नदी"] }] }],
      approval: { required: true, preview: { anyOf: ["नदि", "river"] } },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-forms.create_form {"title":"भारत की नदियाँ - कक्षा 7","questions":[{"title":"गंगा नदी कहाँ से निकलती है?","type":"choice","options":["गंगोत्री","यमुनोत्री","अमरकंटक","मानसरोवर"]},{"title":"भारत की सबसे लंबी नदी कौन सी है?","type":"choice","options":["गंगा","गोदावरी","यमुना","नर्मदा"]},{"title":"नर्मदा नदी किस सागर में गिरती है?","type":"choice","options":["अरब सागर","बंगाल की खाड़ी"]}]}'] },
    tags: ["form", "devanagari"],
  },
  {
    id: "notes-docs-sheets-hi-006", family: "notes-docs-sheets", lang: "hi", split: "dev",
    intent: "An RSVP form with Google Forms named in Latin letters, with the questions they listed.",
    said: "Google Forms में दिवाली पार्टी के लिए RSVP फ़ॉर्म बनाओ: नाम, कितने लोग आएँगे, और खाना veg या non-veg",
    world: FORMS,
    expect: {
      world: [{ kind: "form", title: { anyOf: ["दिवाली", "diwali"] }, questions: [{ anyOf: ["नाम", "name"] }, { anyOf: ["कितने", "how many"] }, { anyOf: ["खाना", "veg", "food"] }] }],
      approval: { required: true, preview: { anyOf: ["दिवाली", "diwali"] } },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE google-forms.create_form {"title":"दिवाली पार्टी RSVP","questions":[{"title":"आपका नाम","type":"text","required":true},{"title":"कितने लोग आएँगे?","type":"text"},{"title":"खाना veg या non-veg?","type":"choice","options":["veg","non-veg"]}]}'] },
    tags: ["form", "mixed-script"],
  },
];
