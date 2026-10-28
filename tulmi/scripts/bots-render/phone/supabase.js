// @supabase/supabase-js for the phone in a browser (render.ts, preview.ts): signed in with a stand-in session, so the
// renderer's calls carry a token as on a device. Nothing here talks to Supabase.
const user = { id: "00000000-0000-4000-8000-00000000aaaa", email: "aanya@example.in" };
const session = { access_token: "preview", refresh_token: "preview", expires_at: 4102444800, token_type: "bearer", user };
const ok = (data) => Promise.resolve({ data, error: null });
export function createClient() {
  return {
    auth: {
      getSession: () => ok({ session }),
      getUser: () => ok({ user }),
      refreshSession: () => ok({ session, user }),
      setSession: () => ok({ session, user }),
      signOut: () => ok({}),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },
  };
}
export default { createClient };
