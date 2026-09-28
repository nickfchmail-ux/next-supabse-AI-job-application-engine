/**
 * Presentation helpers for a job's description text.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The scraper fetches each job's DETAIL page behind a hard time budget
 * (`JOB_DETAIL_BUDGET_MS`, see `azure/functions/src/functions/jobProcessor.ts`).
 * When that budget expires the processor deliberately continues with
 * "listing data only" so the run can still finalise.
 *
 * The problem is what happens next. `enrichOneJob()` in
 * `azure/functions/src/enrich.ts` derives the raw description with:
 *
 *     if (job.rawDetailHtml) { …full advert… }
 *     return job.description ?? "";      // ← the search-listing TEASER
 *
 * so with no detail HTML the listing teaser becomes the *entire* advert.
 * `parseDescription()` then has one line and no section heading, so its
 * `default:` branch files that line under "responsibilities". The stored row
 * therefore ends up with three fields holding the same cut-off string:
 *
 *     short_description === raw_description === responsibilities[0]
 *
 * which the detail page happily printed twice — once under "Job Summary",
 * once under "Responsibilities" — while every other part of the advert was
 * simply missing. It read as though the advert had been truncated mid-
 * sentence, because it had.
 *
 * These helpers let the UI recognise that shape and be honest about it,
 * rather than repeating a teaser as if it were two separate facts.
 *
 * Boards affected are the ones whose detail fetch goes through the slow
 * proxy path (JobsDB, Indeed). Boards with a fast public detail API
 * (LinkedIn, OfferToday, most CTgoodjobs) never hit the budget.
 */

const normalize = (s?: string | null): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

/**
 * True when a string was visibly cut off — it ends in `...` or `…`.
 * Used to avoid presenting a clipped teaser as a complete thought.
 */
export function endsMidSentence(s?: string | null): boolean {
  return /(\.\.\.|…)$/.test(normalize(s));
}

function cleanList(items?: string[] | null): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => normalize(i)).filter((i) => i.length > 0);
}

export interface DescriptionShape {
  /** The headline blurb (the listing teaser when the detail fetch failed). */
  summary: string | null;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  /**
   * True when we hold only the search-listing teaser rather than the full
   * advert — i.e. the detail fetch was skipped, timed out, or was blocked.
   * The UI should say so instead of implying the advert ended there.
   */
  previewOnly: boolean;
}

/**
 * Normalise a job row's description fields for display.
 *
 * Two guarantees, both independent of *why* the data looks the way it does:
 *  1. The summary is never listed a second time under another heading —
 *     the same sentence under two headings is never useful.
 *  2. `previewOnly` is set when all we actually have is the listing teaser,
 *     so the caller can link out to the real advert.
 */
export function describeJob(input: {
  shortDescription?: string | null;
  rawDescription?: string | null;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  benefits?: string[] | null;
}): DescriptionShape {
  const summary = normalize(input.shortDescription) || null;
  const raw = normalize(input.rawDescription);
  const responsibilities = cleanList(input.responsibilities);
  const requirements = cleanList(input.requirements);
  const benefits = cleanList(input.benefits);

  // 1. Drop any "responsibility" that is just the summary repeated. This is
  //    the exact signature of the teaser-fallback bug above.
  const dedupedResponsibilities = summary
    ? responsibilities.filter((r) => r !== summary)
    : responsibilities;

  // 2. Decide whether the full advert was ever captured.
  //
  //    The tell-tale sign is `raw_description` being empty or byte-identical
  //    to the listing teaser: on the happy path `raw_description` is the
  //    detail page (up to 3000 chars) and cannot equal a short listing blurb.
  //
  //    We only call it a preview when that coincidence actually costs the
  //    reader something — i.e. there is no other content to read, or the
  //    teaser itself is visibly clipped. A short-but-complete advert that
  //    happens to be reused as the listing blurb is left alone.
  const rawIsListingTeaser =
    raw.length === 0 || (summary !== null && raw === summary);
  const noOtherContent =
    dedupedResponsibilities.length === 0 &&
    requirements.length === 0 &&
    benefits.length === 0;
  const previewOnly =
    rawIsListingTeaser &&
    summary !== null &&
    (noOtherContent || endsMidSentence(summary));

  return {
    summary,
    responsibilities: dedupedResponsibilities,
    requirements,
    benefits,
    previewOnly,
  };
}
