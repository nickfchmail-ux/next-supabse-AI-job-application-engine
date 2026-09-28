import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Hard ceiling for a SINGLE Supabase HTTP call.
 *
 * PostgREST can accept a request and then never answer at all. Measured live
 * against project `uqrgivzeklqehuqqqqyv`: every authenticated call to
 * `/rest/v1/*` hung indefinitely (no response in 15–30s, repeatedly) while
 * `/auth/v1/health` answered in 0.2s and `/storage/v1/bucket` returned 200 in
 * 1–7s. Because supabase-js has no timeout of its own, the returned promise
 * simply never settled — the HTTP trigger hung past the frontend's 30s abort,
 * and each queue worker burned its entire execution budget on one dead call.
 *
 * 20s sits comfortably above the slowest healthy call we measured (a 6–11s
 * storage download) and far below the Functions timeout, so healthy traffic is
 * unaffected while a wedged backend fails in bounded time.
 */
const REQUEST_TIMEOUT_MS = Number(
  process.env["SUPABASE_REQUEST_TIMEOUT_MS"] ?? 20_000,
);

/**
 * `fetch` with a deadline.
 *
 * The abort message deliberately contains "timed out" so `isTransientDbError`
 * classifies it as a transport failure rather than a data error, which lets
 * `withDbRetry` replay the call (every write in this service is idempotent).
 */
const boundedFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const upstream = init?.signal;

  const forwardAbort = () => controller.abort(upstream?.reason);
  if (upstream) {
    if (upstream.aborted) forwardAbort();
    else upstream.addEventListener("abort", forwardAbort, { once: true });
  }

  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms`),
      ),
    REQUEST_TIMEOUT_MS,
  );

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", forwardAbort);
  });
};

/**
 * Supabase client using the **service-role key** (server-side only).
 * RLS is bypassed intentionally: the evaluator is trusted backend code and
 * writes back `fit` / `fit_score` / `fit_reasons` / `cover_letter` on behalf
 * of the scraping pipeline. Never expose this client to the browser.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  // Reuses the same setting names as the existing scrape Function App.
  const url = process.env["SUPABASE_URL"] || process.env["SupabaseUrl"];
  const key =
    process.env["SUPABASE_SERVICE_KEY"] || process.env["SupabaseServiceKey"];
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY must be set");
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Every REST/Auth/Storage call made through this client is deadline-bound.
    global: { fetch: boundedFetch },
  });
  return cached;
}
