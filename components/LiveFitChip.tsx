"use client";

import { useJobState } from "@/components/JobStateProvider";
import {
  FIT_BUCKET_STYLES,
  FIT_VERDICT_STYLES,
  fitBadge,
  fitVerdictLabel,
  type FitVerdict,
} from "@/lib/funnel";

/**
 * Header fit chip — LIVE version of the server-rendered badge.
 *
 * Reads the shared job state (hydrated from the DB + kept live via Realtime
 * and the `job:state` socket event), so it transitions automatically:
 *   - no score yet → "Matching…" (amber, pulsing)
 *   - scored       → verdict wording + the score itself
 *
 * COLOUR, WORDING and TOOLTIP all come from `lib/funnel.ts` — the app's single
 * source of truth. This chip used to hand-roll its own emerald/red pair, which
 * is how the header could read "Good Fit" in green while the very same job read
 * "Low fit" in amber in the list. Showing the score in the chip keeps the
 * number and the label visibly in agreement.
 *
 * The verdict stays the WORDING (it is the AI's own call, and the AI does
 * legitimately call a job a fit at 48 or a non-fit at 71), but the score is
 * always rendered beside it so the two can never silently disagree.
 */
export default function LiveFitChip({
  initialFit,
  initialFitScore,
}: {
  initialFit: boolean | null;
  initialFitScore: number | null;
}) {
  const { fit, fitScore } = useJobState();
  const score = fitScore ?? initialFitScore;
  const fitFlag = fit ?? initialFit;

  if (score === null || score === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
        <span className="relative flex w-1.5 h-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-amber-500" />
        </span>
        Matching…
      </span>
    );
  }
  const verdict: FitVerdict | null =
    fitFlag === null || fitFlag === undefined
      ? null
      : fitFlag
        ? "fit"
        : "notfit";

  // One canonical source for colour, wording and tooltip.
  const { bucket, badge, copy } = fitBadge(score);
  const color = verdict
    ? FIT_VERDICT_STYLES[verdict]
    : FIT_BUCKET_STYLES[bucket];
  const label = verdict ? fitVerdictLabel(verdict) : badge;

  return (
    <span
      title={`${label} — fit score ${score}/100. ${copy}`}
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}
    >
      {verdict === "fit" ? "✓" : verdict === "notfit" ? "✗" : "•"} {label}
      <span className="tabular-nums opacity-80">
        {score}
        <span className="opacity-60">/100</span>
      </span>
    </span>
  );
}
