"use server";

import { getToken } from "@/lib/auth";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  JobStatus,
  PollProgress,
  PollResultData,
} from "@/types/api";

// ── Start scrape ─────────────────────────────────────────────────

export type StartScrapeResult =
  | { ok: true; jobId: string; pollUrl: string }
  | { ok: false; error: string };

export interface StartScrapeParams {
  keyword: string;
  pages?: number;
  force?: boolean;
  boards?: string[];
}

export async function startScrapeAction(
  params: StartScrapeParams,
): Promise<StartScrapeResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetchWithAuth("/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: params.keyword,
        pages: params.pages ?? 1,
        force: params.force ?? false,
        boards: params.boards,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: body?.message ?? `Server error ${res.status}`,
      };
    }

    const data = await res.json();
    return { ok: true, jobId: data.jobId, pollUrl: data.pollUrl ?? "" };
  } catch {
    return { ok: false, error: "Could not reach scrape server." };
  }
}

// ── Poll job ─────────────────────────────────────────────────────

export type PollResult =
  | {
      ok: true;
      status: JobStatus;
      logs: string[];
      progress?: PollProgress;
      result?: PollResultData;
      error?: string;
    }
  | { ok: false; error: string };

export async function pollJobAction(jobId: string): Promise<PollResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetchWithAuth(`/jobs/${jobId}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: body?.message ?? `Server error ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      ok: true,
      status: data.status,
      logs: data.logs ?? [],
      progress: data.progress,
      result: data.result,
      error: data.error,
    };
  } catch {
    return { ok: false, error: "Could not reach scrape server." };
  }
}
