import { notFound, redirect } from "next/navigation";

import { getUserId } from "@/lib/auth";
import { describeJob } from "@/lib/jobDescription";
import { BulletList, SectionHeading } from "../_components";
import { getJob } from "../_data";

export const revalidate = 0;

function DetailsCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
      {children}
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <SectionHeading className="sticky top-0 bg-white dark:bg-zinc-900 py-1 -mx-6 px-6 z-10">
      {children}
    </SectionHeading>
  );
}

/**
 * Shown when we only hold the search-listing teaser rather than the whole
 * advert (the detail fetch was skipped, blocked, or ran past its budget).
 * Saying so plainly is better than letting a clipped sentence read as if the
 * employer wrote it that way — and better than a silently short page.
 */
function PreviewOnlyNotice({ url }: { url: string | null }) {
  return (
    <p className="mt-3 text-xs text-amber-700 dark:text-amber-400/90 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
      Only the short preview from the job board was captured for this advert —
      the full description wasn&rsquo;t available when it was saved.{" "}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Open the original advert
        </a>
      )}
      {url ? " to read it in full." : ""}
    </p>
  );
}

export default async function DetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { job, error } = await getJob(id, userId);
  if (error || !job) notFound();

  const parseList = (v: unknown): string[] =>
    typeof v === "string" ? JSON.parse(v) : ((v as string[] | null) ?? []);

  const { summary, responsibilities, requirements, benefits, previewOnly } =
    describeJob({
      shortDescription: job.short_description,
      rawDescription: job.raw_description,
      responsibilities: parseList(job.responsibilities),
      requirements: parseList(job.requirements),
      benefits: parseList(job.benefits),
    });

  const hasStructuredContent =
    summary !== null ||
    responsibilities.length > 0 ||
    requirements.length > 0 ||
    benefits.length > 0;

  const fallbackDescription =
    !hasStructuredContent && job.raw_description ? job.raw_description : null;

  if (!hasStructuredContent && !fallbackDescription) {
    return (
      <div className="flex flex-col gap-8 overflow-y-scroll max-h-[500px] scroll-smooth">
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          No details available for this job.{" "}
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:no-underline"
            >
              Open the original advert
            </a>
          )}
          {job.url ? " to see the full description." : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 overflow-y-scroll max-h-[500px] scroll-smooth">
      <DetailsCard>
        {summary && (
          <>
            <Heading>Job Summary</Heading>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
            {previewOnly && <PreviewOnlyNotice url={job.url} />}
          </>
        )}

        {fallbackDescription && (
          <>
            <Heading>Job Description</Heading>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {fallbackDescription}
            </p>
          </>
        )}

        {responsibilities.length > 0 && (
          <>
            <br />
            <Heading>Responsibilities</Heading>
            <BulletList items={responsibilities} />
          </>
        )}

        {requirements.length > 0 && (
          <>
            <br />
            <Heading>Requirements</Heading>
            <BulletList items={requirements} />
          </>
        )}

        {benefits.length > 0 && (
          <>
            <br />
            <Heading>Benefits</Heading>
            <BulletList
              items={benefits}
              icon={
                <svg
                  className="w-4 h-4 text-emerald-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              }
            />
          </>
        )}
      </DetailsCard>
    </div>
  );
}
