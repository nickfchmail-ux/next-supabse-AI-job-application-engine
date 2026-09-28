import { InvocationContext, StorageQueueHandler } from "@azure/functions";
import { withDbRetry } from "../lib/dbRetry.js";
import { evaluateSingleJob } from "../lib/evaluateJob.js";
import { invalidateStateCache, notifyStateChange } from "../lib/socket.js";
import {
  incrementEvaluationRun,
  setPipelineRunEvaluationStatus,
} from "../lib/status.js";
import { getSupabase } from "../lib/supabase.js";
import type { EvaluateJobMessage } from "../shared/types.js";

/**
 * Storage Queue trigger — ONE invocation per job post (fan-out).
 *
 * `POST /api/evaluate` enqueues one message per unevaluated job; Azure scales
 * this trigger across instances, so 20 posts → up to 20 concurrent workers,
 * each scoring exactly one post. This replaces the old single-worker loop.
 *
 * After scoring, the worker ATOMICALLY increments its batch's progress and,
 * when it is the LAST job in the batch, finalizes the run(s).
 *
 * Storage queue messages arrive as a JSON STRING — parse it.
 */
export const evaluateWorker: StorageQueueHandler<EvaluateJobMessage> = async (
  msg: EvaluateJobMessage,
  context: InvocationContext,
): Promise<void> => {
  const parsed =
    typeof msg === "string" ? (JSON.parse(msg) as EvaluateJobMessage) : msg;
  const { jobId, userId, runId, evaluationRunId } = parsed ?? {};
  if (!jobId || !userId || !runId || !evaluationRunId) {
    context.error(`evaluateWorker: malformed message (missing ids)`);
    return;
  }

  context.log(
    `evaluateWorker start: job=${jobId} run=${runId} batch=${evaluationRunId}`,
  );
  const sb = getSupabase();

  let processed = 0;
  let failed = 0;
  let fit = 0;
  let notFit = 0;
  let lastError: string | null = null;

  try {
    const result = await evaluateSingleJob(msg, (m) =>
      context.log(`[job] ${m}`),
    );
    processed = 1;
    if (result.fit) fit = 1;
    else notFit = 1;
  } catch (e) {
    failed = 1;
    lastError = e instanceof Error ? e.message : "Job evaluation failed";
    context.error(`evaluateWorker failed: job=${jobId} ${lastError}`);
  }

  // Atomically roll up this job's outcome into its batch; the RPC returns
  // whether the batch is now complete. The LAST worker finalizes.
  try {
    const res = await incrementEvaluationRun({
      evaluationRunId,
      processed,
      failed,
      fit,
      notFit,
      lastError,
    });
    context.log(
      `batch ${evaluationRunId}: processed=${res.processed}/${res.total} failed=${res.failed} fit=${res.fit} notFit=${res.notFit} done=${res.done}`,
    );
    // Non-fatal: the rollup above already succeeded. A failed push must NOT
    // skip the finalize below — that is what left runs stuck on "Matching…".
    await notifyStateChange(userId, runId).catch((e) =>
      context.error(
        `notify after rollup failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );

    // `res.total > 0` guards a STALE MESSAGE. A retry deletes the previous
    // batch rows and inserts new ones, so a worker redelivered from the old
    // batch finds total=0 — without this guard it would consider itself "done"
    // and flip the CURRENT run's evaluation_status to completed/failed early.
    if (res.total > 0 && res.done) {
      // Mark the batch terminal (completed/failed), then the run(s).
      await withDbRetry(
        `finalize batch ${evaluationRunId}`,
        async () => {
          const { error: batchErr } = await sb
            .from("evaluation_runs")
            .update({
              status: res.processed > 0 ? "completed" : "failed",
              last_error:
                res.failed > 0
                  ? `${res.failed} job(s) could not be matched.`
                  : null,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", evaluationRunId);
          if (batchErr) throw new Error(batchErr.message);
        },
        (m) => context.log(m),
      ).catch((e) =>
        context.error(
          `finalize batch failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

      const overall = res.processed > 0 ? "completed" : "failed";
      const finalErr =
        res.failed > 0 ? `${res.failed} job(s) could not be matched.` : null;
      await setPipelineRunEvaluationStatus(
        runId,
        userId,
        overall,
        finalErr,
      ).catch((e) =>
        context.error(`finalize run ${runId} failed: ${e.message}`),
      );
      // Drop the backend's Redis caches so the push below (and any later
      // status poll) reads FRESH fit/not-fit + terminal status instead of a
      // 20s-stale "evaluating" snapshot.
      await invalidateStateCache(userId, runId).catch((e) =>
        context.error(`invalidate cache ${runId} failed: ${e.message}`),
      );
      await notifyStateChange(userId, runId).catch((e) =>
        context.error(
          `notify after finalize failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  } catch (e) {
    context.error(
      `evaluateWorker rollup failed: job=${jobId} ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};
