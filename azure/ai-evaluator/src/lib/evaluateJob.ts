import type {
  DocumentRequestMessage,
  EvaluateJobMessage,
  JobForEvaluation,
} from "../shared/types.js";
import {
  MIN_ADVERT_CHARS,
  NO_ADVERT_REASON,
  advertText,
  hasUsableAdvert,
} from "./advert.js";
import { evaluateSingleJobWithLLM } from "./ai.js";
import { withDbRetry } from "./dbRetry.js";
import { buildSingleJobPrompt } from "./prompts.js";
import { fetchResumeTextCached, sanitizeResume } from "./resume.js";
import { enqueueDocumentRequest } from "./storageQueue.js";
import { getSupabase } from "./supabase.js";

/**
 * Evaluate ONE job post — the body of a single fan-out worker.
 *
 * Scoring is decoupled from DOCUMENT GENERATION, but for FIT jobs the worker
 * enqueues ONE message to EACH document queue so the DEDICATED functions
 * generate them independently (and in parallel):
 *
 *   - score fit  → enqueue `resume-requests` (resumeWorker)
 *   - score fit  → enqueue `cover-letter-requests` (coverLetterWorker)
 *   - score no-fit → neither (a no-fit job costs exactly one small call)
 *
 *   1. Fetch + sanitize the user's resume (contact-stripped — PII never
 *      reaches the model for scoring).
 *   2. ONE LLM call → fit + fit_score + reasons + justification + salary.
 *   3. Write the scored job row back (`status → analysed`).
 *   4. If fit: mark `resume_status`/`cover_letter_status = building`, then
 *      enqueue one message to each dedicated queue. The workers generate the
 *      artifacts independently and update status → completed/failed (via
 *      Realtime + socket the job detail page streams this live).
 *
 * The resume is fetched here (not carried on the message) so messages stay
 * small and the batch fits within Service Bus's size limit.
 */
export async function evaluateSingleJob(
  msg: EvaluateJobMessage,
  log: (msg: string) => void,
): Promise<{ fit: boolean; score: number }> {
  const sb = getSupabase();

  // Load the one job row (fresh) so we evaluate the latest description.
  // Retried: a transient PostgREST timeout says nothing about the data.
  const jobRow = await withDbRetry(
    `load job ${msg.jobId}`,
    async () => {
      const { data, error } = await sb
        .from("jobs")
        .select("*")
        .eq("id", msg.jobId)
        .eq("user_id", msg.userId)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to load job ${msg.jobId}: ${error.message}`);
      }
      return data;
    },
    log,
  );
  if (!jobRow) throw new Error(`Job ${msg.jobId} not found`);
  const job = jobRow as unknown as JobForEvaluation;

  // ── Refuse to score a job whose advert we never captured ────────────────
  // A board listing carries only a one-line teaser; the real advert arrives
  // from the detail fetch. When that fetch is blocked the row holds nothing
  // but the teaser, and scoring it anyway invented a confident
  // `fit_score: 76` — four "reasons" written from 69 characters. Leave it
  // UNSCORED and say why, rather than manufacture a match.
  //
  // Throwing here is deliberate and safe: `evaluateWorker` catches it and
  // rolls the job into its batch's `failed` counter, so the run still
  // finalizes. A bare `return` would leave `remaining_jobs` above zero
  // forever and the UI stuck on "Matching…". Because the throw is caught
  // INSIDE the worker, the Storage Queue does not redeliver the message.
  // No LLM call is made, so skipping costs nothing.
  if (!hasUsableAdvert(job)) {
    log(
      `job ${job.id}: only ${advertText(job).length} chars of advert captured ` +
        `(min ${MIN_ADVERT_CHARS}) — not scoring`,
    );
    // Skip a redundant write when the row is already flagged this exact way:
    // the UPDATE would bump `updated_at` and push a Realtime event each time.
    const alreadyFlagged =
      job.status === "failed" &&
      (jobRow as unknown as { last_error?: string | null }).last_error ===
        NO_ADVERT_REASON;
    if (!alreadyFlagged) {
      await withDbRetry(
        `flag job ${job.id} (no advert captured)`,
        async () => {
          const { error: flagErr } = await sb
            .from("jobs")
            .update({
              fit: null,
              fit_score: null,
              fit_reasons: [],
              not_fit_reasons: [],
              status: "failed",
              last_error: NO_ADVERT_REASON,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("user_id", msg.userId);
          if (flagErr) throw new Error(flagErr.message);
        },
        log,
      );
    }
    throw new Error(NO_ADVERT_REASON);
  }

  // Resume (contact-stripped for evaluation). Cached per user — see
  // fetchResumeTextCached; the raw object is fetched at most once a minute.
  const rawResume = await fetchResumeTextCached(msg.userId);
  const resumeText = sanitizeResume(rawResume, { includeContact: false });

  // ONE LLM call → fit + score + reasons. No cover letter / resume here.
  const evalResult = await evaluateSingleJobWithLLM(
    buildSingleJobPrompt(resumeText, job),
  );
  if (evalResult.jobId !== job.id) {
    throw new Error(`LLM returned jobId ${evalResult.jobId} for job ${job.id}`);
  }

  const patch: Record<string, unknown> = {
    fit: evalResult.fit,
    fit_score: evalResult.fit_score,
    fit_reasons: evalResult.fit_reasons ?? [],
    not_fit_reasons: evalResult.not_fit_reasons ?? [],
    justification: evalResult.justification ?? null,
    expected_salary: evalResult.expected_salary ?? null,
    status: "analysed",
    updated_at: new Date().toISOString(),
  };

  // Fit → kick off the two INDEPENDENT document builds via their OWN queues.
  // Mark them building (durable across refresh) so the job detail page shows
  // "Generating…", then enqueue ONE message per queue.
  //
  // Idempotency: if a document is ALREADY completed (e.g. a re-evaluation of
  // a job that already has a tailored resume), we don't re-enqueue or clobber
  // it — the user keeps their existing artifact.
  if (evalResult.fit) {
    const now = new Date().toISOString();
    const base: Pick<DocumentRequestMessage, "jobId" | "userId" | "runId"> = {
      jobId: job.id,
      userId: msg.userId,
      runId: msg.runId,
    };

    const resumeAlreadyDone = jobRow.resume_status === "completed";
    const letterAlreadyDone = jobRow.cover_letter_status === "completed";

    if (resumeAlreadyDone) {
      patch.resume_status = "completed";
    } else {
      patch.resume_status = "building";
      patch.resume_started_at = now;
    }
    if (letterAlreadyDone) {
      patch.cover_letter_status = "completed";
    } else {
      patch.cover_letter_status = "building";
      patch.cover_letter_started_at = now;
    }

    // Each send is best-effort — a failure to enqueue must NOT lose the fit
    // score already computed, but we must not leave the job stuck at
    // "building" forever. On failure, mark that artifact `failed` so the UI
    // shows a retry path (the fit score + reasons are preserved).
    const [resumeOk, letterOk] = await Promise.all([
      resumeAlreadyDone
        ? Promise.resolve(true)
        : enqueueDocumentRequest({ ...base, type: "resume" })
            .then(() => true)
            .catch((e) => {
              log(
                `job ${job.id}: resume enqueue failed: ${e instanceof Error ? e.message : e}`,
              );
              return false;
            }),
      letterAlreadyDone
        ? Promise.resolve(true)
        : enqueueDocumentRequest({ ...base, type: "cover-letter" })
            .then(() => true)
            .catch((e) => {
              log(
                `job ${job.id}: cover-letter enqueue failed: ${e instanceof Error ? e.message : e}`,
              );
              return false;
            }),
    ]);
    if (!resumeOk && !resumeAlreadyDone) {
      patch.resume_status = "failed";
      patch.resume_error = "Couldn't start the tailored resume.";
    }
    if (!letterOk && !letterAlreadyDone) {
      patch.cover_letter_status = "failed";
      patch.cover_letter_error = "Couldn't start the cover letter.";
    }
  }

  // ── The most important write in the whole flow ──────────────────────────
  // The LLM call above has ALREADY run (and been paid for). A transient
  // PostgREST `upstream request timeout` here used to throw, and the worker
  // recorded the job as failed — discarding a perfectly good score. Retry
  // until the patch lands; the update is idempotent (full row by job id).
  await withDbRetry(
    `save job ${job.id}`,
    async () => {
      const { error: updateErr } = await sb
        .from("jobs")
        .update(patch)
        .eq("id", job.id)
        .eq("user_id", msg.userId);
      if (updateErr) throw new Error(updateErr.message);
    },
    log,
  );

  log(
    `job done: job=${job.id} fit=${evalResult.fit} score=${evalResult.fit_score}`,
  );
  return { fit: evalResult.fit, score: evalResult.fit_score };
}
