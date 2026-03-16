/* ------------------------------------------------------------------ */
/*  Types for the Jobs Automation REST API                            */
/*  Base URL: https://server-service-874826295461.asia-east1.run.app  */
/* ------------------------------------------------------------------ */

// ── Auth ──────────────────────────────────────────────────────────

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
}

export interface AuthUser {
  id: string;
  email: string;
}

// ── Scrape request / response ────────────────────────────────────

export interface ScrapeRequest {
  keyword: string;
  pages?: number;
  force?: boolean;
  boards?: string[];
}

export interface ScrapeResponse {
  jobId: string;
  pollUrl: string;
}

// ── Poll statuses ────────────────────────────────────────────────

export type JobStatus = "pending" | "scraping" | "running" | "done" | "error";

export interface PollProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

export interface PollResultJob {
  title: string;
  company: string;
  url: string;
  location: string;
  description: string;
  fit: boolean;
  fitReason: string;
  [key: string]: unknown; // other enriched fields
}

export interface PollResultData {
  total: number;
  completed: number;
  failed: number;
  fit: number;
  keyword: string;
  scrapedDate: string;
  jobs: PollResultJob[];
}

/** Shape returned by GET /jobs/<jobId> across all statuses */
export interface PollResponse {
  status: JobStatus;
  logs: string[];
  progress?: PollProgress;  // present when status === "running"
  result?: PollResultData;  // present when status === "done"
  error?: string;           // present when status === "error"
}
