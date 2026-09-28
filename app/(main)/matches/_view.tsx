import FitFilters from "@/components/FitFilters";
import type { JobListItem } from "@/components/JobCard";
import { getJobsByFit } from "@/lib/data-services";
import Link from "next/link";

type MatchesViewProps = {
  userId: string;
  active: "fit" | "notfit";
};

/**
 * The data-dependent half of /matches — fetched lazily inside a <Suspense>
 * boundary so the page shell (header) paints immediately.
 *
 * Loads BOTH fit and not-fit jobs in parallel (so the tab counts are always
 * accurate regardless of which tab is active), then renders the tab toggle +
 * the filtered job list.
 */
export default async function MatchesView({
  userId,
  active,
}: MatchesViewProps) {
  let fitJobs: JobListItem[] = [];
  let notFitJobs: JobListItem[] = [];
  try {
    // getJobsByFit is React.cache()-memoized per request and uses the
    // projected JOBS_LIST_SELECT — NOT `select("*")` (heavy detail columns
    // like raw_description/cover_letter are never rendered on lists, and
    // fetching them for every row was a major Supabase exhaustor).
    const [fit, notFit] = await Promise.all([
      getJobsByFit({ userId, fit: true }),
      getJobsByFit({ userId, fit: false }),
    ]);
    fitJobs = (fit as JobListItem[] | null) ?? [];
    notFitJobs = (notFit as JobListItem[] | null) ?? [];
  } catch (e) {
    console.error("[Matches] error:", e);
  }

  const tabs = [
    { key: "fit", label: "Good fit", count: fitJobs.length, href: "/matches" },
    {
      key: "notfit",
      label: "Not a fit",
      count: notFitJobs.length,
      href: "/matches?view=notfit",
    },
  ] as const;

  return (
    <>
      {/* Toggle + what the two signals mean. The tab is the AI's verdict; the fit
          score is a separate 0-100 strength reading. Colouring both
          independently is what let a row appear to contradict its own tab. */}
      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="Filter by fit"
          className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1"
        >
          {tabs.map((t) => (
            <Link
              key={t.key}
              role="tab"
              aria-selected={active === t.key}
              href={t.href}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 ${
                active === t.key
                  ? t.key === "fit"
                    ? "bg-[var(--good)] text-white"
                    : "bg-[var(--bad)] text-white"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--paper-soft)]"
              }`}
            >
              {t.label}
              <span className="font-data text-xs tabular-nums opacity-80">
                {t.count}
              </span>
            </Link>
          ))}
        </div>
        <p className="text-sm text-[var(--ink-soft)]">
          {active === "fit"
            ? "The AI's verdict is fit. The fit score shows how strong the match was — a lower score here is a fit it was less sure about."
            : "The AI's verdict is not a fit. The fit score shows how close it got — a high score here is a near-miss worth a second look."}
        </p>
      </div>

      {active === "fit" ? (
        <FitFilters
          jobs={fitJobs}
          verdict="fit"
          from="/matches"
          emptyMessage="No jobs the AI called a fit yet — run a search, then match it against your resume."
        />
      ) : (
        <FitFilters
          jobs={notFitJobs}
          verdict="notfit"
          from="/matches?view=notfit"
          emptyMessage="Nothing has been ruled out yet — the AI hasn't called anything a non-fit."
        />
      )}
    </>
  );
}
