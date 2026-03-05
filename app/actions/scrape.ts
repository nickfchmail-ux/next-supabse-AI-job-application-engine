"use server";

import { getToken } from "@/lib/auth";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type StartScrapeResult =
  | { ok: true; jobId: string; pollUrl: string }
  | { ok: false; error: string };

export async function startScrapeAction(
  keyword: string,
  pages: number,
  force: boolean = false,
): Promise<StartScrapeResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetchWithAuth("/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, pages, force }),
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

export type PollResult =
  | { ok: true; status: string; logs: string[]; result?: unknown }
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
      result: data.result,
    };
  } catch {
    return { ok: false, error: "Could not reach scrape server." };
  }
}
