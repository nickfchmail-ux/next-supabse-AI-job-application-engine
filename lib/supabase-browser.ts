import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client used ONLY for Realtime subscriptions
 * (postgres_changes) and storage downloads on the client.
 *
 * RLS filters automatically once the user's access token is set as the
 * session — see setSupabaseSession().
 *
 * `autoRefreshToken:false` is CRITICAL: the app's auth is the httpOnly
 * `token` cookie (verified by the Next.js proxy), NOT supabase-js's own
 * session. Without this, supabase-js tries to refresh the (empty-refresh)
 * session every ~60s → `setSession({refresh_token:""})` → 400 → the
 * recurring "An unexpected response was received from the server"
 * unhandledRejection. Realtime only needs the access token for RLS; the
 * JWT is re-issued on every navigation by the proxy.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/**
 * Set the user's access token as the Realtime session so postgres_changes
 * rows are scoped to them (RLS). We pass the SAME token as refresh_token so
 * supabase-js never triggers a refresh (autoRefreshToken is off anyway) —
 * an empty refresh_token was what made the client attempt a refresh.
 */
export function setSupabaseSession(accessToken: string) {
  const sb = getSupabaseBrowser();
  sb.auth.setSession({
    access_token: accessToken,
    refresh_token: accessToken,
  });
}

/**
 * Drop the Browser client's session WITHOUT touching Supabase's servers.
 *
 * ⚠️ NEVER call `sb.auth.signOut()` here.
 *
 * `signOut()` defaults to `{ scope: "global" }` (see auth-js
 * `SIGN_OUT_SCOPES[0]`), which POSTs `/auth/v1/logout?scope=global` and
 * **revokes every refresh token for the user**. The session we hand to
 * supabase-js IS the app's own session — `setSupabaseSession()` passes the
 * httpOnly `token` cookie's value — so a "global" sign-out killed the app's
 * `refresh_token` cookie too.
 *
 * It was invisible at first: the access token keeps working until it expires
 * (~1h), so nothing looked wrong. Then the next navigation hit `proxy.ts`,
 * which called `/auth/refresh`, got a 401 for the now-revoked token, took
 * `transient: false` and deleted both cookies → bounced to /login.
 *
 * This is an effect CLEANUP (see `useRealtimeRun`), so it ran on every
 * unmount — merely navigating away from the live dashboard revoked the
 * user's session, and the logout appeared to strike at random up to an hour
 * later. That was the recurring "app suddenly logs me out".
 *
 * `_removeSession()` clears the in-memory session and fires SIGNED_OUT with
 * zero network calls, which is exactly the local teardown we want. It is
 * internal API, so the call is optional: if a future version renames it we
 * degrade to a no-op, which is safe — leaving the session in memory is
 * harmless (the next mount re-sets it), whereas revoking it is not.
 */
export function clearSupabaseSession() {
  const sb = getSupabaseBrowser();
  void Promise.resolve(
    (
      sb.auth as unknown as { _removeSession?: () => unknown }
    )._removeSession?.(),
  ).catch(() => {
    /* best-effort teardown — never let this throw into a render cleanup */
  });
}
