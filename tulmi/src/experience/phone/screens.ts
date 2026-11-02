/**
 * The phone app's screens: phoneScreen picks the builder for a screen id.
 */

import type { ScreenResponse } from "../../../../shared/types/sdui.js";
import { buildAssistantScreen } from "../assistant.js";
import { botsKeyboardRecord, botsKeyboardPrimer, botsFlowArm } from "../bots/screens/handoff.js";
import { canOnboard, onboardScreen } from "../onboard.js";
import { canOnboardStore, onboardStoreScreen } from "../onboardStore.js";
import { freeForAll } from "../policy.js";
import type { ScreenContext } from "../screens.js";
import { WORDS_GATE } from "../wordsGate.js";
import { deleteAccountScreen } from "./deleteAccount.js";
import { flowArmScreen } from "./flowArm.js";
import { historyScreen } from "./history.js";
import { homeScreen } from "./home.js";
import { introScreen } from "./intro.js";
import { keyboardPrimerScreen } from "./keyboardPrimer.js";
import { keyboardRecordScreen } from "./keyboardRecord.js";
import { languageSelectScreen } from "./languageSelect.js";
import { languagesScreen } from "./languages.js";
import { onDesk } from "./layout.js";
import { NAV } from "./navigation.js";
import { onboardingKeyboard } from "./onboarding/keyboard.js";
import { onboardingVoice } from "./onboarding/voice.js";
import { paywallScreen } from "./paywall.js";
import { replyScreen } from "./reply.js";
import { settingsScreen } from "./settings.js";
import { statsScreen } from "./stats.js";
import { cancelSubscriptionScreen } from "./subscription.js";
import { trainingChatScreen } from "./training/chat.js";
import { trainingLiveScreen } from "./training/live.js";
import { usageOutScreen, freeNowScreen } from "./usageOut.js";
import { wordsOutScreen } from "./wordsOut.js";
import { assistantNameScreen } from "./you/assistantName.js";
import { YOU_UI } from "./you/copy.js";
import { dictionaryScreen } from "./you/dictionary.js";
import { hapticsScreen } from "./you/haptics.js";
import { personalityScreen } from "./you/personality.js";
import { personalityCustomizeScreen } from "./you/personalityCustomize.js";
import { personalityDetailScreen } from "./you/personalityDetail.js";
import { personalityEditScreen } from "./you/personalityEdit.js";
import { toneEditScreen } from "./you/toneEdit.js";
import { voiceReadScreen } from "./you/voiceRead.js";
import { voicesScreen } from "./you/voices.js";

export function phoneScreen(screenId: string, ctx: ScreenContext): ScreenResponse | null {
  switch (screenId) {
    case "home":
      return homeScreen(ctx);
    case "training_chat":
      return trainingChatScreen(ctx);
    case "training_live":
      return trainingLiveScreen(ctx);
    case "dictionary":
      return dictionaryScreen(ctx);
    case "haptics":
      return hapticsScreen(ctx);
    case "language_select":
      return languageSelectScreen(ctx);
    case "languages":
      return languagesScreen(ctx);
    case "voice_read":
      return voiceReadScreen(ctx);
    case "assistant_name":
      return assistantNameScreen(ctx);
    // The assistant on the phone: Connected apps, Tasks, the confirm sheet
    // (experience/assistant.ts). The words are the shared table's, so these
    // opt out of the capitalising pass below the way assistant.ts explains.
    case "assistant_apps":
    case "assistant_tasks":
    case "assistant_approve":
    case "assistant_app_tools":
      return buildAssistantScreen(screenId, { assistant: ctx.assistant, params: ctx.params, can: ctx.can }, YOU_UI);
    case "assistant_ask":
      return buildAssistantScreen(screenId, {
        assistant: ctx.assistant, params: ctx.params, can: ctx.can,
        connectorsOn: ctx.connectorsOn, language: ctx.language, platform: ctx.platform, tzOffsetMinutes: ctx.tzOffsetMinutes,
      }, YOU_UI);
    case "delete_account":
      return deleteAccountScreen();
    case "cancel_subscription":
      return cancelSubscriptionScreen(ctx);
    case WORDS_GATE.outScreenId:
      // The free words, or the usage meter: while Tailzu is free, for someone who pays (no words to run out of), or when the words
      // are not the ones used up, it was the meter.
      return freeForAll() || ctx.entitlement || (ctx.allowance && ctx.allowance.used < ctx.allowance.total) ? usageOutScreen(WORDS_GATE.outScreenId) : wordsOutScreen(ctx);
    case "reply":
      return replyScreen();
    case "personality":
      return personalityScreen(ctx);
    case "voices":
      return voicesScreen(ctx);
    case "tone_edit":
      return toneEditScreen(ctx);
    case "personality_customize":
      return personalityCustomizeScreen(ctx.personality);
    case "personality_edit":
      return personalityEditScreen(
        ctx.personality,
        typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined,
      );
    case "personality_detail":
      return personalityDetailScreen(
        ctx.personality,
        typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined,
      );
    case "settings":
      return settingsScreen(ctx);
    case "stats":
      return statsScreen(ctx);
    case "history":
      return historyScreen(ctx);
    case "onboarding":
      return onboardingVoice(ctx);
    // The new onboarding after sign-in, for a build that can draw it. Any other
    // build that asks (a stale link, a cached id) is given today's first step,
    // so the request never comes back empty.
    case "onboard":
      return canOnboard(ctx.can)
        ? onboardScreen(ctx, NAV.kind === "tabs" ? NAV.tabs[0]?.id : undefined)
        // The same onboarding for the builds in the stores (onboardStore.ts):
        // what they run on a first launch cannot draw the stage.
        : canOnboardStore(ctx.can, ctx.formFactor)
          ? onboardStoreScreen(ctx)
          : onboardingVoice(ctx);
    // "onboarding_language" removed — the language pick is the client's native
    // post-auth screen now (needsLanguagePick bootstrap flag). Unknown ids fall
    // through to null → 404, which the client surfaces gracefully.
    case "onboarding_keyboard":
      return onboardingKeyboard();
    // The Bots app draws the same screens in its own look: the same state and actions (bots/screens/handoff.ts).
    case "keyboard_record":
      return ctx.bots ? botsKeyboardRecord(keyboardRecordScreen(ctx)) : keyboardRecordScreen(ctx);
    case "keyboard_primer":
      return ctx.bots ? botsKeyboardPrimer(keyboardPrimerScreen(ctx)) : keyboardPrimerScreen(ctx);
    case "flow_arm":
      return ctx.bots ? botsFlowArm(flowArmScreen(ctx)) : flowArmScreen(ctx);
    case "intro":
      return introScreen(ctx);
    case "paywall":
      // A link to it can still exist (an old push, a cached screen): it says
      // Tailzu is free and goes back, and sells nothing.
      if (freeForAll()) return freeNowScreen("paywall");
      return paywallScreen(ctx.formFactor === "desktop", ctx.entitlement,
        onDesk(ctx) ? { kind: "switchTab", tabId: "desk_today" } : undefined);
    default:
      return null;
  }
}
