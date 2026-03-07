"use client";

import { pollJobAction, startScrapeAction } from "@/app/actions/scrape";
import { parseScrapeLogs } from "@/lib/parseScrapeLogs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

type Phase = "idle" | "starting" | "polling" | "done" | "error";

export default function ScrapePanel({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [pages, setPages] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();
  const [showToast, setShowToast] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const stepsContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll steps to bottom
  useEffect(() => {
    const el = stepsContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Auto-refresh page when scrape completes and show toast
  useEffect(() => {
    if (phase === "done") {
      router.refresh();
      setShowToast(true);
      const t = setTimeout(() => {
        setShowToast(false);
        setPhase("idle");
        setLogs([]);
        setJobId(null);
      }, 4000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function schedulePoll(id: string) {
    pollRef.current = setTimeout(async () => {
      const result = await pollJobAction(id);

      if (!result.ok) {
        setPhase("error");
        setErrorMsg(result.error);
        return;
      }

      setLogs(result.logs);

      if (result.status === "done") {
        setPhase("done");
        return;
      }
      if (result.status === "error") {
        setPhase("error");
        setErrorMsg("Scrape job failed on the server.");
        return;
      }

      schedulePoll(id); // keep polling
    }, 5000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;

    setPhase("starting");
    setLogs([]);
    setErrorMsg("");
    setJobId(null);
    if (pollRef.current) clearTimeout(pollRef.current);

    startTransition(async () => {
      const result = await startScrapeAction(keyword.trim(), pages);

      if (!result.ok) {
        setPhase("error");
        setErrorMsg(result.error);
        return;
      }

      setJobId(result.jobId);
      setPhase("polling");
      schedulePoll(result.jobId);
    });
  }

  const isRunning = phase === "starting" || phase === "polling";

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
          <svg
            className="w-4 h-4 text-blue-600 dark:text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Search Jobs
          </h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Scrape &amp; analyse new listings from JobsDB and CTgoodjobs
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="px-6 py-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label
              htmlFor="keyword"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
            >
              Keyword
            </label>
            <input
              id="keyword"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. web dev, frontend, react"
              disabled={isRunning}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
            />
          </div>

          <div className="sm:w-28">
            <label
              htmlFor="pages"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
            >
              Pages
            </label>
            <select
              id="pages"
              value={pages}
              onChange={(e) => setPages(Number(e.target.value))}
              disabled={isRunning}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
            >
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "page" : "pages"}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:self-end">
            <button
              type="submit"
              disabled={isRunning || !keyword.trim() || !hasResume}
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 transition-colors"
            >
              {isRunning ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Searching…
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  Search
                </>
              )}
            </button>
          </div>
        </div>

        {/* No resume warning */}
        {!hasResume && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            You need to upload your resume before searching for matches.{" "}
            <a
              href="/profile"
              className="font-semibold underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
            >
              Upload resume →
            </a>
          </p>
        )}
      </form>

      {/* Toast */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-emerald-600 text-white text-sm font-medium px-5 py-3.5 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <svg
            className="w-4 h-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Search complete! Results updated.
        </div>
      )}

      {/* Status / Logs area */}
      {phase !== "idle" && phase !== "done" && (
        <div className="px-6 pb-6 space-y-3">
          {/* Progress summary */}
          {(logs.length > 0 || phase === "error") &&
            (() => {
              const s = parseScrapeLogs(logs);
              return (
                <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 space-y-3">
                  {/* Current phase + progress bar */}
                  {s.currentPhaseName && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-300">
                          {s.currentPhaseName}
                        </span>
                        {s.progress && (
                          <span className="text-xs text-zinc-500">
                            {s.progress}
                          </span>
                        )}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-500"
                          style={{
                            width: (() => {
                              if (s.currentPhase === 1) return "25%";
                              if (s.currentPhase === 2 && s.enrichProgress)
                                return `${25 + Math.round((s.enrichProgress.done / s.enrichProgress.total) * 25)}%`;
                              if (s.currentPhase === 3 && s.analysisProgress)
                                return `${50 + Math.round((s.analysisProgress.done / s.analysisProgress.total) * 25)}%`;
                              if (s.currentPhase === 4) return "90%";
                              return "10%";
                            })(),
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Quick stats */}
                  {s.stats.scraped > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <StatPill label="Found" value={s.stats.scraped} />
                      {s.stats.duplicatesRemoved > 0 && (
                        <StatPill
                          label="Duplicates"
                          value={s.stats.duplicatesRemoved}
                          muted
                        />
                      )}
                      {s.stats.alreadyProcessed > 0 && (
                        <StatPill
                          label="Already seen"
                          value={s.stats.alreadyProcessed}
                          muted
                        />
                      )}
                      {s.stats.newJobs > 0 && (
                        <StatPill
                          label="New"
                          value={s.stats.newJobs}
                          highlight
                        />
                      )}
                    </div>
                  )}

                  {/* Early stop notice */}
                  {s.earlyStop && (
                    <p className="text-xs text-amber-400">
                      All results were already up to date — nothing new to
                      process.
                    </p>
                  )}

                  {/* Fit results */}
                  {s.fitResults && (
                    <div
                      ref={stepsContainerRef}
                      className="space-y-1.5 overflow-y-auto"
                      style={{ maxHeight: "150px" }}
                    >
                      <div className="flex items-center gap-3 pb-1">
                        <span className="text-xs font-medium text-emerald-400">
                          ✓ {s.fitResults.fit} match
                          {s.fitResults.fit !== 1 ? "es" : ""}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {s.fitResults.noFit} not a fit
                        </span>
                      </div>
                      {s.fitResults.fitJobs.map((job, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-xs text-zinc-300 truncate">
                            {job.title}
                            <span className="text-zinc-500">
                              {" "}
                              @ {job.company}
                            </span>
                          </span>
                          <span className="text-xs font-semibold text-emerald-500 shrink-0">
                            {job.score}
                          </span>
                        </div>
                      ))}
                      {phase === "polling" && s.analysisProgress && (
                        <div className="flex items-center gap-2 pt-0.5">
                          <svg
                            className="w-3 h-3 text-blue-400 shrink-0 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          <span className="text-xs text-zinc-500 animate-pulse">
                            Analysing…
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Errors */}
                  {(s.errors.length > 0 || phase === "error") && (
                    <div className="space-y-1">
                      {phase === "error" && errorMsg && (
                        <p className="text-xs text-red-400">{errorMsg}</p>
                      )}
                      {s.errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-400">
                          {e}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Polling spinner (no fit results yet) */}
                  {phase === "polling" && !s.fitResults && (
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-3 h-3 text-blue-400 shrink-0 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      <span className="text-xs text-zinc-500 animate-pulse">
                        Working…
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  muted,
  highlight,
}: {
  label: string;
  value: number;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        highlight
          ? "bg-blue-900/60 text-blue-300"
          : muted
            ? "bg-zinc-800 text-zinc-500"
            : "bg-zinc-800 text-zinc-300"
      }`}
    >
      <span className="font-semibold">{value}</span> {label}
    </span>
  );
}
