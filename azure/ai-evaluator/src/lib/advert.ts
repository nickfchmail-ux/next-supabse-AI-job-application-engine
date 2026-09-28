import type { JobForEvaluation } from "../shared/types.js";

/**
 * How much advert text we must have captured before a fit score means
 * anything at all.
 *
 * The board's SEARCH LISTING only carries a one-line teaser — the whole
 * advert arrives later from the DETAIL page fetch (stored as
 * `raw_description`). When that fetch is blocked (Cloudflare challenge →
 * residential fallback unconfigured) the row keeps nothing but the teaser,
 * and scoring it anyway produced a confident `fit_score: 76` with four
 * "reasons" written from 69 characters — job `94906846`
 * ("Programmer 40K+ (Immediate Available)"), whose only text was
 * "To support IT application development, implementation and maintenance".
 * That is not a match, it is a guess dressed up as one.
 *
 * Below this threshold the advert counts as NOT captured and the job is left
 * unscored, with the reason recorded on the row.
 *
 * MUST stay in sync with `MIN_ADVERT_CHARS` in the scraper's
 * `azure/functions/src/functions/jobProcessor.ts`, which uses the same
 * threshold to report `data_quality.has_description` honestly.
 */
export const MIN_ADVERT_CHARS = Number(
  process.env["EVAL_MIN_ADVERT_CHARS"] || 200,
);

/**
 * All advert text actually captured for a job, best source first.
 *
 * Ordering matters for diagnosis, not for the total: the count is what drives
 * the decision.
 */
export function advertText(job: JobForEvaluation): string {
  return [
    job.raw_description,
    // Extracted sections are parsed OUT of the advert body, so their presence
    // proves the detail page was read even when `raw_description` is empty.
    ...(job.responsibilities ?? []),
    ...(job.requirements ?? []),
    ...(job.benefits ?? []),
    // The listing teaser is a last resort: a manually-added job may have no
    // separate advert body, in which case a long note is all there is.
    job.short_description,
  ]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join("\n")
    .trim();
}

/** Whether we captured enough of the advert for a fit score to mean anything. */
export function hasUsableAdvert(job: JobForEvaluation): boolean {
  return advertText(job).length >= MIN_ADVERT_CHARS;
}

/**
 * Stored on `jobs.last_error` so the UI (and ops) can explain why a job has
 * no score instead of showing a blank.
 */
export const NO_ADVERT_REASON =
  "Only the short preview from the job board was captured, so this job " +
  "can't be matched yet — the full advert couldn't be read.";
