export type FitJob = {
  title: string;
  company: string;
  score: number;
};

export type ScrapeLogSummary = {
  currentPhase: 1 | 2 | 3 | 4 | null;
  currentPhaseName: string | null;
  progress: string | null;
  stats: {
    scraped: number;
    duplicatesRemoved: number;
    alreadyProcessed: number;
    newJobs: number;
  };
  enrichProgress: { done: number; total: number } | null;
  analysisProgress: { done: number; total: number } | null;
  fitResults: {
    fit: number;
    noFit: number;
    fitJobs: FitJob[];
  } | null;
  errors: string[];
  rowsSaved: number | null;
  earlyStop: boolean;
};

export function parseScrapeLogs(logs: string[]): ScrapeLogSummary {
  const summary: ScrapeLogSummary = {
    currentPhase: null,
    currentPhaseName: null,
    progress: null,
    stats: {
      scraped: 0,
      duplicatesRemoved: 0,
      alreadyProcessed: 0,
      newJobs: 0,
    },
    enrichProgress: null,
    analysisProgress: null,
    fitResults: null,
    errors: [],
    rowsSaved: null,
    earlyStop: false,
  };

  let enrichTotal = 0;
  let enrichDone = 0;
  let analysisTotal = 0;
  let analysisDone = 0;
  let fitCount = 0;
  let noFitCount = 0;
  const fitJobs: FitJob[] = [];

  for (const line of logs) {
    // ── Phase headers ──
    if (/Phase 1.*Scraping/i.test(line)) {
      summary.currentPhase = 1;
      summary.currentPhaseName = "Collecting job listings";
      continue;
    }
    if (/Phase 2.*Enriching/i.test(line)) {
      const m = line.match(/Enriching (\d+)/);
      if (m) {
        enrichTotal = parseInt(m[1], 10);
        summary.enrichProgress = { done: 0, total: enrichTotal };
      }
      summary.currentPhase = 2;
      summary.currentPhaseName = "Fetching job details";
      continue;
    }
    if (/Phase 3.*Analysing/i.test(line)) {
      summary.currentPhase = 3;
      summary.currentPhaseName = "Analysing job fit";
      continue;
    }
    if (/Phase 4.*Uploading/i.test(line)) {
      summary.currentPhase = 4;
      summary.currentPhaseName = "Saving results";
      continue;
    }

    // Phase 1 — Scraping
    const scrapedMatch = line.match(
      /Scraped (\d+) jobs? \((\d+) duplicates? removed\)/,
    );
    if (scrapedMatch) {
      summary.stats.scraped = parseInt(scrapedMatch[1], 10);
      summary.stats.duplicatesRemoved = parseInt(scrapedMatch[2], 10);
      continue;
    }

    const alreadyMatch = line.match(/(\d+) job\(s\) already in Supabase/);
    if (alreadyMatch) {
      summary.stats.alreadyProcessed = parseInt(alreadyMatch[1], 10);
      continue;
    }

    if (/All scraped jobs are already processed/.test(line)) {
      summary.earlyStop = true;
      continue;
    }

    // Phase 2 — Enriching progress
    const fetchMatch = line.match(/\[fetch (\d+)\/(\d+)\]/);
    if (fetchMatch) {
      enrichDone = parseInt(fetchMatch[1], 10);
      enrichTotal = Math.max(enrichTotal, parseInt(fetchMatch[2], 10));
      summary.enrichProgress = { done: enrichDone, total: enrichTotal };
      continue;
    }

    const pwMatch = line.match(/\[pw (\d+)\/(\d+)\]/);
    if (pwMatch) {
      // Playwright jobs come after HTTP, add to enrichDone offset by HTTP done count
      const pwI = parseInt(pwMatch[1], 10);
      const pwTotal = parseInt(pwMatch[2], 10);
      const httpDone = enrichTotal - pwTotal;
      summary.enrichProgress = { done: httpDone + pwI, total: enrichTotal };
      continue;
    }

    const pwFailMatch = line.match(/\[pw \d+\] ✗ Failed \(([^)]+)\): (.+)/);
    if (pwFailMatch) {
      summary.errors.push(`Could not fetch details for "${pwFailMatch[1]}"`);
      continue;
    }

    const httpDoneMatch = line.match(
      /Phase 1 done — (\d+) enriched via fetch, (\d+) need Playwright/,
    );
    if (httpDoneMatch) {
      enrichDone = parseInt(httpDoneMatch[1], 10);
      enrichTotal = enrichDone + parseInt(httpDoneMatch[2], 10);
      summary.enrichProgress = { done: enrichDone, total: enrichTotal };
      continue;
    }

    // Phase 3 — Analysis progress
    const analysingMatch = line.match(/Analysing (\d+) job/);
    if (analysingMatch) {
      analysisTotal = parseInt(analysingMatch[1], 10);
      summary.analysisProgress = { done: 0, total: analysisTotal };
      continue;
    }

    const fitMatch = line.match(/\[(\d+)\/(\d+)\] .+ — ✅ FIT \((\d+)\)/);
    if (fitMatch) {
      analysisDone = parseInt(fitMatch[1], 10);
      analysisTotal = Math.max(analysisTotal, parseInt(fitMatch[2], 10));
      fitCount++;
      const parts = line.match(/\[(?:\d+)\/(?:\d+)\] (.+) @ (.+) — ✅/);
      if (parts) {
        fitJobs.push({
          title: parts[1].trim(),
          company: parts[2].trim(),
          score: parseInt(fitMatch[3], 10),
        });
      }
      summary.analysisProgress = { done: analysisDone, total: analysisTotal };
      summary.fitResults = { fit: fitCount, noFit: noFitCount, fitJobs };
      continue;
    }

    const noFitMatch = line.match(/\[(\d+)\/(\d+)\] .+ — ❌ NO FIT/);
    if (noFitMatch) {
      analysisDone = parseInt(noFitMatch[1], 10);
      analysisTotal = Math.max(analysisTotal, parseInt(noFitMatch[2], 10));
      noFitCount++;
      summary.analysisProgress = { done: analysisDone, total: analysisTotal };
      summary.fitResults = { fit: fitCount, noFit: noFitCount, fitJobs };
      continue;
    }

    const aiErrorMatch = line.match(/\[(\d+)\/(\d+)\] ✗ (.+)/);
    if (aiErrorMatch) {
      summary.errors.push(
        `Analysis failed for job ${aiErrorMatch[1]}: ${aiErrorMatch[3]}`,
      );
      continue;
    }

    // Phase 4 — Upload
    const upsertMatch = line.match(/Upserted (\d+) rows/);
    if (upsertMatch) {
      summary.rowsSaved = parseInt(upsertMatch[1], 10);
      continue;
    }

    if (/Supabase error:/i.test(line)) {
      summary.errors.push("A database error occurred while saving results.");
      continue;
    }
  }

  // Derive a progress string for the current phase
  if (summary.currentPhase === 2 && summary.enrichProgress) {
    const { done, total } = summary.enrichProgress;
    summary.progress = `Fetched details for ${done} of ${total} jobs`;
  } else if (summary.currentPhase === 3 && summary.analysisProgress) {
    const { done, total } = summary.analysisProgress;
    summary.progress = `Analysed ${done} of ${total} jobs`;
  } else if (summary.currentPhase === 1 && summary.stats.scraped > 0) {
    summary.progress = `Found ${summary.stats.scraped} listings`;
  }

  // Compute newJobs
  summary.stats.newJobs = Math.max(
    0,
    summary.stats.scraped -
      summary.stats.duplicatesRemoved -
      summary.stats.alreadyProcessed,
  );

  return summary;
}
