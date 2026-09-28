import ScrapePanelWithResume from "@/app/(main)/_resume";
import EvaluationStep from "@/components/EvaluationStep";
import PageHeader from "@/components/PageHeader";
import RunHistory from "@/components/RunHistory";
import { getUserId } from "@/lib/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Search",
};

/**
 * /search — the action hub.
 *
 * This is where the user actually DOES the work: run a search (scrape job
 * boards) and then match the results against their resume. It's deliberately
 * separated from /overview (the analysis) so the dashboard shows insight,
 * and this page is a focused, single-purpose flow.
 */
export default async function SearchPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <PageHeader
        eyebrow="Search &amp; match"
        title="Find jobs worth applying to"
        subtitle="Two steps: find listings from the job boards, then have the AI score them against your resume. The strong fits get a cover letter and a tailored resume."
      />

      {/* Step 1 — Search (scrape). Collecting listings is NOT scoring them, and
          the step label says so explicitly: users used to assume a search on
          its own produced fit scores. */}
      <section className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-[var(--line)] flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
          <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[10px]">
            1
          </span>
          Find jobs
          <span className="ml-auto normal-case tracking-normal font-medium">
            Collected, not scored
          </span>
        </div>
        <div className="p-6">
          <Suspense
            fallback={
              <div className="space-y-3">
                <div className="h-10 rounded-xl bg-[var(--paper-soft)] animate-pulse" />
                <div className="h-7 w-64 rounded-full bg-[var(--paper-soft)] animate-pulse" />
              </div>
            }
          >
            <ScrapePanelWithResume />
          </Suspense>
        </div>
      </section>

      {/* Step 2 — Match. Rendered as its OWN card (NOT inside the overflow-hidden
          section) so the search-key dropdown is never clipped. Always visible
          whenever there are search keys with unevaluated posts. */}
      <section id="match" className="card">
        <div className="px-6 py-3 border-b border-[var(--line)] flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
          <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[10px]">
            2
          </span>
          Score them
          <span className="ml-auto normal-case tracking-normal font-medium">
            This is the step that decides fit
          </span>
        </div>
        <div className="p-6">
          <EvaluationStep />
        </div>
      </section>

      <RunHistory />

      <p className="text-center text-sm text-[var(--ink-faint)]">
        Want the big picture?{" "}
        <Link
          href="/overview"
          className="font-medium text-[var(--accent-ink)] hover:underline"
        >
          View your insights →
        </Link>
      </p>
    </div>
  );
}
