/**
 * Deleting the account.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";

export function deleteAccountScreen(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "delete_account",
    title: "",
    state: {},
    actions: {
      // signOut lives in onSuccess, NOT after the call in a sequence: a failed
      // DELETE used to fall through to signOut anyway, so the user saw an
      // error toast, got signed out, and reasonably concluded the deletion
      // worked — a live 5.1.1(v) hazard.
      confirm: {
        kind: "callEndpoint",
        method: "DELETE",
        path: "/v1/account",
        onSuccess: "deleted",
        onError: "err",
      },
      deleted: { kind: "sequence", actions: [
        { kind: "toast", message: "Your account has been deleted.", tone: "success" },
        { kind: "signOut" },
      ] },
      err: { kind: "toast", message: "Couldn't delete the account. Try again.", tone: "error" },
    },
    root: { type: "Screen", children: [
      { type: "Heading", props: { content: "Delete account" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 14 } },
      { type: "Paragraph", props: { content: "This permanently deletes your account, your personality, and your usage. This cannot be undone." }, style: { marginBottom: 14 } },
      // What deletion KEEPS, said here too and not only on the web page (docs: perms2 §11.4): a one-way hash of the email and
      // of the app's own install number, for 30 days, so a deleted account cannot be used to start the free plan again.
      { type: "Paragraph", props: { content: "For 30 days afterwards we keep a one-way hash of your email address, and of the random number this app made when it was installed, only to stop a new free account being started straight away. Neither can be read back, and neither is kept with your name or anything you wrote. If a free plan was started on your iPhone, Apple keeps, for us, a small mark on that phone saying so (DeviceCheck). It holds no account, email or name; we stop reading it after 12 months, and clear it if you ask at support@x0bot.com." }, style: { marginBottom: 32 } },
      { type: "Button", props: { label: "Delete my account", variant: "danger" }, on: { onPress: "confirm" } },
      { type: "Spacer", style: { height: 10 } },
      { type: "Button", props: { label: "Cancel", variant: "secondary" }, on: { onPress: { kind: "navigateBack" } } },
    ] },
    cacheTtlSeconds: 0,
  };
}
