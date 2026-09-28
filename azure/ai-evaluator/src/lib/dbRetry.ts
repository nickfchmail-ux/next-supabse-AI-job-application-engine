/**
 * Retry Supabase operations that failed for a TRANSIENT infrastructure reason.
 *
 * Supabase's API Gateway answers a slow upstream with a bare error body whose
 * `message` is `upstream request timeout`, and its storage layer with
 * `DatabaseTimeout` (HTTP 544). Neither says anything about the DATA — the
 * request simply never landed, so the operation is safe to replay.
 *
 * This matters enormously at the END of an evaluation: the LLM call has already
 * run and been paid for, so a one-second gateway hiccup on the final
 * `jobs` UPDATE must not throw the score away. Observed live: a 24-job batch
 * recorded 17 failures whose only message was `upstream request timeout` — every
 * one of those jobs HAD been scored, and every score was discarded by this.
 *
 * Every write in this service is idempotent (a full-row patch keyed by job id,
 * an atomic counter RPC, a status flip), so replaying it cannot double-apply.
 */

/**
 * Messages that mean "the transport died", never "the data was rejected".
 * Deliberately excludes 4xx-class data errors (constraint violations, 401/403,
 * bad requests) — those must fail fast, not be retried.
 */
const TRANSIENT_RE =
  /upstream request timeout|upstream[ _-]?timeout|timed?[ _-]?out|database[ _-]?timeout|database ?timed? ?out|connection (to the database )?(timed out|refused|reset)|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|network error|fetch failed|service unavailable|bad gateway|gateway timeout|abort(ed)?|deadline|\b50[234]\b|\b544\b/i;

export function isTransientDbError(message: string): boolean {
  return TRANSIENT_RE.test(message);
}

/** Backoff schedule — tuned so the total added latency stays well under the
 *  function timeout while riding out a multi-second gateway stall. */
const RETRY_DELAYS_MS = [1_000, 3_000, 7_000, 15_000];

/**
 * Run `fn`, retrying while it throws a TRANSIENT error (see above).
 *
 * @param label short description used in logs, e.g. `save job 64f3…`
 * @param fn    the operation; throw to signal failure
 * @param log   optional sink for retry notices (the Functions context.log)
 */
export async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  log?: (msg: string) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const isLast = attempt === RETRY_DELAYS_MS.length;
      if (isLast || !isTransientDbError(msg)) throw e;
      const wait = RETRY_DELAYS_MS[attempt];
      log?.(
        `[dbRetry] ${label}: transient error (${msg}) — retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
