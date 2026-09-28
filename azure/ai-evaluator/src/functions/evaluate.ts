import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { enqueueEvaluationJobs } from "../lib/storageQueue.js";
import { getSupabase } from "../lib/supabase.js";
import {
  consumeUsage,
  refundUsage,
  UsageLimitReachedError,
} from "../lib/usage.js";
import type {
  EvaluateJobMessage,
  EvaluateRequest,
  EvaluateResponse,
  JobForEvaluation,
} from "../shared/types.js";

/**
 * How long an in-flight evaluation may sit without progress before we treat it
 * as dead and allow the user to start it again. A batch can be abandoned
 * mid-run — every remaining queue message dies on a transient Supabase
 * storage/DB timeout, or the instance handling them is recycled — which leaves
 * `pipeline_runs.evaluation_status` frozen on `evaluating` forever.
 */
const STALE_EVAL_MS = 10 * 60 * 1000;

/**
 * Budget for a SINGLE Supabase round-trip on the request path.
 *
 * This handler makes several Supabase calls in sequence, so one unbounded call
 * is enough to turn a slow database into "Evaluation took too long to start." —
 * an error the user can neither act on nor distinguish from a crash. 45s leaves
 * room for the genuinely slow calls (a 500-row `jobs` select) while still
 * replying with something retryable when the database is genuinely down.
 */
const DB_CALL_TIMEOUT_MS = Number(
  process.env["EVALUATE_DB_TIMEOUT_MS"] ?? 45_000,
);

/**
 * Budget for the WHOLE request, across every Supabase call it makes.
 *
 * Per-call timeouts alone are not enough: this handler makes ~7 calls in
 * sequence, so a fully stalled database would take ~7 x 45s to produce an
 * error — far longer than the client will wait, which reproduces the original
 * "took too long" symptom. Once this budget is spent the remaining calls fail
 * immediately and the handler returns its 503 straight away.
 */
const REQUEST_BUDGET_MS = Number(
  process.env["EVALUATE_REQUEST_BUDGET_MS"] ?? 60_000,
);

/** A Supabase call that never answered — always transient, never a data error. */
class DbUnavailableError extends Error {}

/** Classify an error/message as "the transport died", not "the data was rejected". */
function isDbUnavailable(e: unknown): boolean {
  if (e instanceof DbUnavailableError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /timed?[ _-]?out|abort(ed)?|upstream request|database[ _-]?timeout|fetch failed|socket hang up|\b50[234]\b|\b544\b/i.test(
    msg,
  );
}

/**
 * The database did not answer in time — retryable, and not the caller's fault.
 */
function dbUnavailable(detail: string): HttpResponseInit {
  return json(
    {
      error:
        "The database didn't respond in time. Please try again in a moment.",
      detail,
    },
    503,
  );
}

/**
 * POST /api/evaluate
 *
 * The single entry point for AI evaluation. Loads the unevaluated jobs,
 * creates one `evaluation_runs` batch row per keyword, fetches the resume
 * ONCE, and enqueues **ONE Service Bus message PER JOB POST** — a true
 * fan-out. Azure scales the `evaluateWorker` queue trigger across instances,
 * so 20 posts → up to 20 concurrent workers, each scoring exactly one post.
 *
 * Body: { runId, user_id, search_key? }
 */
export const evaluate: HttpHandler = async (
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> => {
  context.log("evaluate trigger invoked");

  let body: EvaluateRequest;
  try {
    body = (await req.json()) as EvaluateRequest;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const runId = body?.runId;
  const userId = body?.user_id;
  if (!runId || !userId) {
    return json({ error: "runId and user_id are required" }, 400);
  }

  /** Normalize a search key to the stored form: lowercase + underscores. */
  const normalizeKey = (s: string): string =>
    s.trim().toLowerCase().replace(/\s+/g, "_");

  const sb = getSupabase();

  // Whole-request budget, shared by every Supabase call below.
  const deadlineAt = Date.now() + REQUEST_BUDGET_MS;

  /**
   * Await a Supabase call, bounded by both the per-call and the request budget.
   * Defined here (not at module scope) so it can see this request's deadline;
   * module-level state would be shared across concurrent invocations.
   */
  async function dbCall<T>(label: string, op: PromiseLike<T>): Promise<T> {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new DbUnavailableError(
        `${label} skipped: request budget of ${REQUEST_BUDGET_MS}ms exhausted`,
      );
    }
    const budget = Math.max(1_000, Math.min(DB_CALL_TIMEOUT_MS, remaining));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        op,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DbUnavailableError(
                  `${label} timed out after ${budget}ms`,
                ),
              ),
            budget,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  try {
    // 1. The run must exist and belong to this user. The search key is read
    //    from the RUN ROW (source of truth) — never trusted from the client,
    //    which avoids the scrape-vs-evaluate keyword mismatch entirely.
    const { data: run, error: runErr } = await dbCall(
      "load run",
      sb
        .from("pipeline_runs")
        .select("id, status, evaluation_status, search_key, updated_at")
        .eq("id", runId)
        .eq("user_id", userId)
        .maybeSingle(),
    );

    if (runErr) {
      if (isDbUnavailable(runErr.message))
        return dbUnavailable("Failed to load run");
      return json({ error: runErr.message, detail: "Failed to load run" }, 500);
    }
    if (!run) {
      return json({ error: "Run not found" }, 404);
    }

    // The client always sends the search_key it wants to match (picked from a
    // dropdown derived from the user's real jobs). Honor it — it lets the user
    // match a DIFFERENT key than this run's own keyword via the same entry
    // point. Fall back to the run's stored key only when the client omitted
    // one (defensive).
    const searchKey = body?.search_key
      ? normalizeKey(body.search_key)
      : (run.search_key ?? "").trim() || undefined;

    // 2. When a search key is provided, the evaluator runs ACCOUNT-WIDE (all
    //    unevaluated jobs with that key across every run) — it does NOT need
    //    this specific run to be "completed". So only enforce the run-status
    //    gate when evaluating run-scoped (no key).
    if (!searchKey && run.status !== "completed") {
      const active = ["queued", "scraping", "processing", "retrying"].includes(
        run.status,
      );
      return json(
        {
          error: active
            ? "The search is still running — jobs aren't ready to match yet."
            : "This search didn't finish, so there's nothing to match yet.",
        },
        409,
      );
    }

    // 3. Don't restart evaluation that's already running or done. For the
    //    account-wide (keyed) case, "done" means no unevaluated jobs remain —
    //    allow re-running so the user can match a different search key from
    //    the same run. Only block an actively-running evaluation.
    //
    //    STALE GUARD: only block when the in-flight evaluation is RECENT. A
    //    dead batch would otherwise reject every retry with "This run is
    //    already being matched." while nothing is actually running.
    const inFlight =
      run.evaluation_status === "evaluating" ||
      run.evaluation_status === "queued";
    const evalAgeMs = run.updated_at
      ? Date.now() - new Date(run.updated_at as string).getTime()
      : Number.POSITIVE_INFINITY;
    if (inFlight && evalAgeMs < STALE_EVAL_MS) {
      return json({ error: "This run is already being matched." }, 409);
    }

    // 4. Load the unevaluated jobs to fan out. When a search key is given,
    //    this spans ALL runs (account-wide); otherwise it's scoped to runId.
    //
    //    IMPORTANT: do NOT filter on status ∈ {completed, analysed}. Jobs that
    //    were scraped but whose enrichment/processing step never advanced them
    //    to `completed` (e.g. stuck `queued` rows) are STILL unevaluated and
    //    must be matchable — the dropdown counts them (fit_score IS NULL), so
    //    excluding them here made the endpoint return 404 "No saved jobs found"
    //    and the Match button fail with "We couldn't start matching your jobs".
    //    The real signal for "needs matching" is `fit_score IS NULL`.
    const normalizedKey = searchKey?.trim().toLowerCase().replace(/\s+/g, "_");
    let jobQuery = sb
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "duplicate")
      .is("fit_score", null)
      .limit(500);
    if (normalizedKey) {
      jobQuery = jobQuery.eq("search_key", normalizedKey);
    } else {
      jobQuery = jobQuery.eq("pipeline_run_id", runId);
    }
    const { data: jobRows, error: jobsErr } = await dbCall(
      "load jobs",
      jobQuery,
    );
    if (jobsErr) {
      if (isDbUnavailable(jobsErr.message))
        return dbUnavailable("Failed to load jobs");
      return json(
        { error: jobsErr.message, detail: "Failed to load jobs" },
        500,
      );
    }
    const jobs = (jobRows ?? []) as unknown as JobForEvaluation[];
    if (jobs.length === 0) {
      return json({ error: "No saved jobs found for this run yet." }, 404);
    }

    // 4b. ── AUTHORITATIVE USAGE ENFORCEMENT ───────────────────
    // The backend deducts the evaluation quota HERE (single writer). This is
    // the real enforcement — the frontend only disables the button. If the
    // user is out of quota, reject before any work is enqueued.
    let usageId: string | null = null;
    try {
      const usage = await dbCall(
        "consume usage",
        consumeUsage(userId, "evaluation", { searchKey: searchKey ?? null }),
      );
      if (!usage.ok) {
        if (usage.reason === "limit_reached") {
          return json({ error: `LIMIT_REACHED: ${usage.message}` }, 402);
        }
        return json({ error: usage.message }, 400);
      }
      usageId = usage.id ?? null;
    } catch (e) {
      if (e instanceof UsageLimitReachedError) {
        return json({ error: `LIMIT_REACHED: ${e.message}` }, 402);
      }
      throw e;
    }

    // 5. Mark queued up-front so a second click is rejected, then create one
    //    evaluation_runs batch row per keyword and enqueue ONE message per job.
    await dbCall(
      "mark run queued",
      sb
        .from("pipeline_runs")
        .update({
          evaluation_status: "queued",
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("user_id", userId),
    );

    const now = new Date().toISOString();
    const batches = groupJobs(jobs);
    await dbCall(
      "clear old evaluation runs",
      sb
        .from("evaluation_runs")
        .delete()
        .eq("pipeline_run_id", runId)
        .eq("user_id", userId)
        .then(({ error }) => {
          if (error) {
            throw new Error(
              `Failed to clear old evaluation runs: ${error.message}`,
            );
          }
        }),
    );

    const { data: inserted, error: insertErr } = await dbCall(
      "create evaluation runs",
      sb
        .from("evaluation_runs")
        .insert(
          batches.map((b) => ({
            pipeline_run_id: runId,
            user_id: userId,
            keyword: b.keyword,
            status: "queued",
            total_jobs: b.jobs.length,
            processed_jobs: 0,
            failed_jobs: 0,
            last_error: null,
            created_at: now,
            updated_at: now,
          })),
        )
        .select("id, keyword"),
    );
    if (insertErr) {
      throw new Error(`Failed to create evaluation runs: ${insertErr.message}`);
    }
    const runIdByKeyword = new Map(
      (inserted ?? []).map((r) => [r.keyword, r.id] as [string, string]),
    );

    const messages: EvaluateJobMessage[] = jobs.map((job) => {
      const keyword = (job.search_key ?? "general").trim().toLowerCase();
      const evaluationRunId = runIdByKeyword.get(keyword);
      if (!evaluationRunId) {
        throw new Error(`No evaluation run for keyword "${keyword}"`);
      }
      return {
        jobId: job.id,
        userId,
        runId,
        evaluationRunId,
        keyword,
      };
    });

    try {
      await enqueueEvaluationJobs(messages);
    } catch (enqErr) {
      // The evaluation quota was already deducted — refund it since the
      // messages never got enqueued (nothing was actually evaluated).
      if (usageId != null) {
        await refundUsage(userId, "evaluation", searchKey ?? null).catch(
          () => {},
        );
      }
      throw enqErr;
    }

    const response: EvaluateResponse = {
      runId,
      keywordBatches: batches.map((b) => ({
        keyword: b.keyword,
        jobCount: b.jobs.length,
      })),
      totalJobs: jobs.length,
      status: "queued",
      statusUrl: `/api/evaluate/${runId}`,
    };
    return json(response, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`evaluate failed: ${msg}`);
    // A dead or stalled PostgREST is not the caller's fault, and the same click
    // usually succeeds a moment later. Reporting 503 keeps that distinction
    // visible instead of collapsing it into a generic server error.
    if (isDbUnavailable(e)) return dbUnavailable(msg);
    return json({ error: msg }, 500);
  }
};

/** Group jobs by search_key (keyword); jobs without one fall into "general". */
function groupJobs(jobs: JobForEvaluation[]): {
  keyword: string;
  jobs: JobForEvaluation[];
}[] {
  const buckets = new Map<string, JobForEvaluation[]>();
  for (const job of jobs) {
    const keyword = (job.search_key ?? "general").trim().toLowerCase();
    if (!buckets.has(keyword)) buckets.set(keyword, []);
    buckets.get(keyword)!.push(job);
  }
  return [...buckets.entries()].map(([keyword, keywordJobs]) => ({
    keyword,
    jobs: keywordJobs,
  }));
}

function json(body: unknown, status: number): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: new Headers({ "Content-Type": "application/json" }),
  };
}
