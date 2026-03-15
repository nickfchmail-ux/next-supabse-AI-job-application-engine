import InfiniteJobList from "@/components/InfiniteJobList";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Good Fit Jobs",
};

export default function FitPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Good Fit Jobs
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Jobs that matched your profile
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <InfiniteJobList
          queryKey="fit-jobs"
          apiUrl="/api/jobs/fit"
          emptyMessage="No matching jobs yet"
        />
      </main>
    </div>
  );
}
