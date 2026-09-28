import {
  FIT_BUCKET_STYLES,
  FIT_VERDICT_STYLES,
  fitBadge,
  fitVerdictLabel,
  type FitVerdict,
} from "@/lib/funnel";

/**
 * The one and only rendering of a numeric fit score.
 *
 * Both the card view (`JobCard`) and the table view (`FitFilters`) draw this, so a
 * job looks identical whichever view the user picked — previously the two views
 * used the same thresholds but different markup and one of them dropped the `/100`.
 *
 * `verdict` is the AI's binary fit / not-a-fit call. Pass it whenever the list is
 * scoped to one verdict (the /matches tabs): the chip then takes the verdict's
 * colour so it can never contradict the tab it sits under. Leave it undefined for
 * lists that mix verdicts, where the score bucket is the only signal available.
 */
export default function FitScoreBadge({
  score,
  verdict,
}: {
  score: number | null | undefined;
  verdict?: FitVerdict | null;
}) {
  if (score === null || score === undefined) return null;

  const { bucket, badge, copy } = fitBadge(score);
  const color = verdict
    ? FIT_VERDICT_STYLES[verdict]
    : FIT_BUCKET_STYLES[bucket];
  const title = verdict
    ? `${fitVerdictLabel(verdict)} — fit score ${score}/100. ${copy}`
    : `${badge} — fit score ${score}/100. ${copy}`;

  return (
    <span
      title={title}
      className={`font-data text-xs font-semibold px-2.5 py-1 rounded-full border tabular-nums whitespace-nowrap ${color}`}
    >
      {score}
      <span className="opacity-60">/100</span>
    </span>
  );
}
