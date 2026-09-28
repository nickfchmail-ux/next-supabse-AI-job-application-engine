#!/usr/bin/env node
/**
 * End-to-end driver for the deployed evaluation flow.
 *
 * Drives the REAL production evaluator over HTTP exactly as the frontend does —
 * POST /api/evaluate, then poll the status endpoint until every batch is
 * terminal — and exits non-zero if anything failed or timed out.
 *
 * This exists because the failure modes here are not visible from unit tests:
 * a wedged Supabase pool, a warm-up cold start, a queue that never drains, and
 * a batch that reports "completed" while individual jobs timed out. It was this
 * script that proved the 9/9, 0-failed result after the PostgREST fix, versus
 * the earlier 17-of-24 `upstream request timeout` failures.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   EVALUATOR_KEY=<function-key> RUN_ID=<run-uuid> USER_ID=<user-uuid> \
 *     node scripts/e2e-evaluate.mjs [search_key]
 *
 * Every credential comes from the environment — never hardcode a key here.
 *
 *   EVALUATOR_URL   base URL. Default: the production evaluator.
 *   EVALUATOR_KEY   required. The app's `default` function key
 *                   (`az functionapp keys list -g jobsautomation-rg -n <app>`).
 *   RUN_ID          required. A pipeline_runs row that is `completed`.
 *   USER_ID         required. The owning user.
 *   SEARCH_KEY      optional; passed in the body as `search_key`.
 *
 * ── Exit codes ───────────────────────────────────────────────────────────────
 *   0  every batch reached `completed` with no timeout in `lastError`
 *   1  bad configuration / could not start the batch
 *   2  batch ran but reported failures, timeouts, or never went terminal
 */
import process from "node:process";

const BASE = (process.env.EVALUATOR_URL ?? "https://jobsautomation-evaluator-v2.azurewebsites.net").replace(/\/+$/, "");
const KEY = process.env.EVALUATOR_KEY ?? "";
const RUN_ID = process.env.RUN_ID ?? "";
const USER_ID = process.env.USER_ID ?? "";
const SEARCH_KEY = process.env.SEARCH_KEY || process.argv[2] || undefined;

// The frontend aborts its own POST after 150s and its status GET after 60s. Keep
// the driver at or above those so it observes what the browser would send, but
// bounded so a hung pool surfaces as a failure rather than an indefinite wait.
const START_TIMEOUT_MS = Number(process.env.START_TIMEOUT_MS ?? 150_000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 60_000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const OVERALL_BUDGET_MS = Number(process.env.OVERALL_BUDGET_MS ?? 10 * 60 * 1000);

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function fail(code, message) {
  log(`FATAL: ${message}`);
  process.exit(code);
}

if (!KEY) fail(1, "EVALUATOR_KEY is not set.");
if (!RUN_ID) fail(1, "RUN_ID is not set.");
if (!USER_ID) fail(1, "USER_ID is not set.");

// ─── 1. Start the batch ───────────────────────────────────────────────────────
// A 202 is the only success signal. On a stalled database the deployed handler
// now fails fast with a 503 "The database didn't respond in time" rather than
// hanging — so a 503 here points at Supabase, not at this script.
const t0 = Date.now();
let res;
try {
  res = await fetch(`${BASE}/api/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-functions-key": KEY },
    body: JSON.stringify({ runId: RUN_ID, user_id: USER_ID, search_key: SEARCH_KEY }),
    signal: AbortSignal.timeout(START_TIMEOUT_MS),
  });
} catch (e) {
  fail(1, `POST /api/evaluate could not complete: ${e?.name} ${e?.message}`);
}

const raw = await res.text();
log(`POST /api/evaluate -> HTTP ${res.status} in ${Date.now() - t0}ms`);
log(`  body: ${raw.slice(0, 400)}`);

if (res.status === 503) {
  fail(1, "503 — the database is not responding. Check Supabase before retrying.");
}
if (res.status !== 202) {
  fail(1, `expected 202, got ${res.status}. Nothing was queued.`);
}

let started;
try {
  started = JSON.parse(raw);
} catch {
  fail(1, `202 with a non-JSON body: ${raw.slice(0, 200)}`);
}
log(`  totalJobs=${started.totalJobs} batches=${started.keywordBatches} status=${started.status}`);

const statusUrl = new URL(started.statusUrl ?? `/api/evaluate/${RUN_ID}`, `${BASE}/`).toString();

// ─── 2. Poll until terminal ───────────────────────────────────────────────────
const deadline = Date.now() + OVERALL_BUDGET_MS;
let final = null;
let lastLine = "";

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

  let poll;
  try {
    poll = await fetch(statusUrl, {
      headers: { "x-functions-key": KEY },
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (e) {
    // A transient poll failure is not fatal — the batch keeps running server-side.
    log(`poll error: ${e?.name} ${e?.message}`);
    continue;
  }

  const text = await poll.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    log(`poll HTTP ${poll.status} non-JSON: ${text.slice(0, 200)}`);
    continue;
  }
  final = json;

  const batches = json.batches ?? [];
  const line = batches
    .map((b) => `${b.keyword ?? "?"}=${b.status} ${b.processedJobs ?? 0}/${b.totalJobs ?? 0} failed=${b.failedJobs ?? 0} fit=${b.fitJobs ?? 0}`)
    .join(" | ");
  if (line !== lastLine) {
    log(`poll ${line || JSON.stringify(json).slice(0, 200)}`);
    lastLine = line;
  }

  if (batches.length > 0 && batches.every((b) => ["completed", "failed"].includes(b.status ?? ""))) {
    break;
  }
}

// ─── 3. Verdict ───────────────────────────────────────────────────────────────
if (!final) fail(2, "no status response before the overall budget elapsed.");

log("──────────────── FINAL ────────────────");
log(JSON.stringify(final, null, 2).slice(0, 2000));

const batches = final.batches ?? [];
if (batches.length === 0) fail(2, "run reported no batches.");

const notTerminal = batches.filter((b) => !["completed", "failed"].includes(b.status ?? ""));
if (notTerminal.length > 0) {
  fail(2, `batch(es) never reached a terminal state: ${notTerminal.map((b) => b.keyword ?? "?").join(", ")}`);
}

const failed = batches.filter((b) => (b.failedJobs ?? b.failed_jobs ?? 0) > 0);
const timedOut = batches.filter((b) => /timeout/i.test(String(b.lastError ?? b.last_error ?? "")));
const notCompleted = batches.filter((b) => b.status !== "completed");

if (failed.length || timedOut.length || notCompleted.length) {
  if (failed.length) log(`FAIL: batches with failed jobs: ${failed.map((b) => `${b.keyword}(${b.failedJobs})`).join(", ")}`);
  if (timedOut.length) log(`FAIL: batches reporting a timeout: ${timedOut.map((b) => b.keyword).join(", ")}`);
  if (notCompleted.length) log(`FAIL: batches not completed: ${notCompleted.map((b) => `${b.keyword}=${b.status}`).join(", ")}`);
  process.exit(2);
}

const processed = batches.reduce((n, b) => n + (b.processedJobs ?? 0), 0);
log(`RESULT: PASS — ${processed} job(s) scored across ${batches.length} batch(es), 0 failed, no timeouts`);
process.exit(0);
