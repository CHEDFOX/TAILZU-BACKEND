/**
 * KEYBOT: the keyboard bot's pages (KeyOn, KeyLive, KeyReply, KeyRewrite, KeyTone, KeyTrain, KeyVoices, KeyWords,
 * KeyHistory, KeySettings and their D* boards). The keyboard's own settings screens stay reachable as they are.
 *
 * Screen ids are "bots.<name>"; one id serves the phone and the window (ctx.client). Build each with the kit
 * (../kit.ts) the way screens/shell.ts builds bots.home, and see docs/bots-app.md. This file is yours: nothing
 * else needs editing to add a screen here.
 */
import type { BotsScreen } from "../registry.js";

export const keybotScreens: BotsScreen[] = [];
