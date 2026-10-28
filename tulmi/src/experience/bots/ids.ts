/**
 * THE BOTS APP'S SCREEN IDS (kit.ts re-exports them): one per board pair, grouped by the file that builds them.
 */
import type { ActionSpec } from "../../../../shared/types/sdui.js";

/**
 * The Bots app's screen ids, one per board pair (phone board / desktop board), by the file that builds them.
 * Link with these, never with a literal. An id not built yet answers the "on its way" page (registry), so a link to it
 * is never a dead end.
 */
export const SCREENS = {
  // screens/shell.ts: Home and around it, first run, system states
  home: "bots.home",                 // Main / DeskHome (built: the reference screen)
  activity: "bots.activity",         // Activity / DeskActivity
  ask: "bots.ask",                   // Ask / DAsk, DeskAsk (a minimal answer page is built; replace it)
  search: "bots.search",             // Search / DSearch
  tasks: "bots.tasks",               // Tasks / DTasks
  approve: "bots.approve",           // Approve / DApprove
  shareIn: "bots.share-in",          // ShareIn / DShareIn
  attach: "bots.attach",             // Attach / DAttach
  done: "bots.done",                 // Done / DDone
  failed: "bots.failed",             // Failed / DFailed
  offline: "bots.offline",           // Offline / DOffline
  empty: "bots.empty-home",          // EmptyHome / DEmptyHome
  welcome: "bots.welcome",           // Welcome / DWelcome, DeskStart
  firstWords: "bots.first-words",    // FirstWords / DFirstWords
  nameIt: "bots.name-it",            // NameIt / DNameIt
  signIn: "bots.sign-in",            // SignIn / DSignIn
  signCode: "bots.sign-code",        // SignCode / DSignCode
  lock: "bots.lock",                 // Lock (phone only)
  widgets: "bots.widgets",           // Widgets / DWidgets
  today: "bots.today",               // DeskToday (the window's Today; the phone draws it in a column)
  notes: "bots.notes",               // DeskNotes (meeting notes; params: q)
  note: "bots.note",                 // DeskNote (one meeting's notes; params: id)
  // screens/you.ts: You and its settings
  you: "bots.you",                   // You / DYou
  budget: "bots.budget",             // Budget / DBudget
  billing: "bots.billing",           // Billing / DBilling
  plans: "bots.plans",               // Plans / DPlans
  computer: "bots.computer",         // Devices / DeskComputer ("This computer helps")
  link: "bots.link",                 // Link a computer: approve a computer's sign-in from the phone (params: l token or c code; screens/link.ts)
  language: "bots.language",         // Language / DLanguage
  notify: "bots.notify",             // Notify / DNotify
  privacy: "bots.privacy",           // Privacy / DPrivacy
  deleteAccount: "bots.delete-account", // DeleteAcct / DDeleteAcct
  apps: "bots.apps",                 // Apps / DApps
  appConnect: "bots.app-connect",    // AppConnect / DAppConnect (params: id)
  settings: "bots.settings",         // DeskSettings
  // screens/bots.ts: the bots themselves
  bot: "bots.bot",                   // BotPage / DBotPage (params: slug)
  make: "bots.make",                 // MakeBot / DMakeBot
  edit: "bots.edit",                 // BotEdit / DBotEdit (params: slug)
  keys: "bots.keys",                 // BotKeys / DBotKeys (params: slug)
  store: "bots.store",               // BotStore / DBotStore
  plan: "bots.plan",                 // PlanBot / DPlanBot (params: week, day)
  planItem: "bots.plan.item",        // no board: add or change an event or a to-do on the person's own calendar (screens/planItem.ts; params: kind, id, day)
  travel: "bots.travel",             // TravelBot / DTravelBot
  chat: "bots.chat",                 // Chat (params: slug)
  spaces: "bots.spaces",             // Spaces / DSpaces
  avatars: "bots.avatars",           // Avatars (the five moments)
  // screens/spaces.ts: spaces with family and friends (bots.spaces is built there too), sharing, payments, tasks, messaging
  spaceMember: "bots.space.member",  // What <name> can do (params: id, member)
  spaceInvite: "bots.space.invite",  // Invite by link or email (params: id)
  spaceRoles: "bots.space.roles",    // The space's own roles (params: id, role)
  spaceItem: "bots.space.item",      // One shared thing (params: item)
  spacePay: "bots.space.pay",        // Ask for a payment (params: id)
  spaceTasks: "bots.space.tasks",    // Given to you; a space's tasks; a new task or plan (params: id, new: "task" | "plan")
  share: "bots.share",               // Share to a space or person (params: kind, ref, title, text, url, bot)
  chats: "bots.chats",               // Chats (params: id, the open one in the window; new: "group")
  thread: "bots.thread",             // One chat (params: id, before)
  // screens/keybot.ts
  keybot: "bots.keybot",             // Keybot / DKeybot
  keyOn: "bots.keybot.on",           // KeyOn / DKeyOn
  keyLive: "bots.keybot.live",       // KeyLive
  keyReply: "bots.keybot.reply",     // KeyReply / DKeyReply
  keyRewrite: "bots.keybot.rewrite", // KeyRewrite / DKeyRewrite
  keyTone: "bots.keybot.tone",       // KeyTone / DKeyTone
  keyTrain: "bots.keybot.train",     // KeyTrain / DKeyTrain
  keyVoices: "bots.keybot.voices",   // KeyVoices / DKeyVoices
  keyWords: "bots.keybot.words",     // KeyWords / DKeyWords
  keyHistory: "bots.keybot.history", // KeyHistory / DKeyHistory
  keySettings: "bots.keybot.settings", // KeySettings / DKeySettings
  keyPill: "bots.keybot.pill",       // DeskPill
  // screens/keybotStats.ts and keybotYou.ts: the old Stats tab and You tab, in Keybot (docs/bots-keybot-parity.md).
  // No boards of their own: drawn in Keybot's look (KeySettings, KeyWords) from the old screens' contents.
  keyMonth: "bots.keybot.month",     // This month: typed against said, the words left, every day, spoken, all time
  keyDay: "bots.keybot.day",         // One day (params: day, its place in the last 30; none is today)
  keyApps: "bots.keybot.apps",       // Where the words went (params: app, one app's page)
  keySpeak: "bots.keybot.speak",     // How you speak: languages, how the words came, pace, voices, register
  keyDays: "bots.keybot.days",       // Days and sessions: the streak, the days, sessions, when, how long
  keyStyle: "bots.keybot.style",     // Voice: the voices it writes in, on the keyboard, made and edited
  keyHaptics: "bots.keybot.haptics", // Haptics: every key, or keys picked one by one
  keyName: "bots.keybot.name",       // What you call it: Tailzu, and a name of your own
  // screens/code.ts
  code: "bots.code",                 // CodeHome / DCodeHome, DeskCode
  codeJob: "bots.code.job",          // Job / DeskWork (params: id)
  codePlan: "bots.code.plan",        // CodePlan / DCodePlan
  codeReview: "bots.code.review",    // CodeReview / DCodeReview
  prCare: "bots.code.pr-care",       // PRCare / DPRCare
  projectRules: "bots.code.rules",   // ProjectRules / DProjectRules
  newProject: "bots.code.new",       // NewProject / DNewProject
  preview: "bots.code.preview",      // Preview / DPreview
  design: "bots.code.design",        // Design / DeskDesign
  team: "bots.code.team",            // TeamBoard / DTeamBoard
  codeStart: "bots.code.start",      // Enter1-4 / DEnter1-4 (params: step)
} as const;

/** Where a bot opens: the built-ins have their own pages, a person's own bot the shared bot page. */
export function botRoute(slug: string): ActionSpec {
  const own: Record<string, string> = { code: SCREENS.code, keybot: SCREENS.keybot, plan: SCREENS.plan, travel: SCREENS.travel };
  return own[slug] ? { kind: "navigate", screenId: own[slug]! } : { kind: "navigate", screenId: SCREENS.bot, params: { slug } };
}

