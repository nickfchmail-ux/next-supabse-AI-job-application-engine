"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { useState } from "react";

interface Props {
  letter: string;
  title: string;
  company: string;
}

async function buildDocx(
  letter: string,
  title: string,
  company: string,
): Promise<Blob> {
  const lines = letter.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      paragraphs.push(new Paragraph({ text: "" }));
    } else {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 24, font: "Calibri" })],
          spacing: { after: 120 },
          alignment: AlignmentType.LEFT,
        }),
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `Cover Letter — ${title}`,
                bold: true,
                size: 32,
                font: "Calibri",
                color: "1D4ED8",
              }),
            ],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: company,
                size: 24,
                font: "Calibri",
                color: "6B7280",
              }),
            ],
            spacing: { after: 400 },
          }),
          new Paragraph({
            border: {
              bottom: { color: "DBEAFE", style: BorderStyle.SINGLE, size: 8 },
            },
            spacing: { after: 400 },
            text: "",
          }),
          ...paragraphs,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

export default function CoverLetterActions({ letter, title, company }: Props) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(letter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const blob = await buildDocx(letter, title, company);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cover-letter-${company.replace(/\s+/g, "-").toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-blue-100 dark:border-blue-900/50 overflow-hidden">
      {/* Section header + action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/50">
        <span className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-400">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Cover Letter
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
          >
            {copied ? (
              <>
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
                <span className="text-emerald-600 dark:text-emerald-400">
                  Copied!
                </span>
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {downloading ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
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
                Exporting…
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download DOCX
              </>
            )}
          </button>
        </div>
      </div>

      {/* Letter body — full text, no collapse */}
      <div className="p-6 bg-white dark:bg-zinc-900">
        <p className="text-sm leading-7 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-(family-name:--font-geist-sans)">
          {letter}
        </p>
      </div>
    </section>
  );
}
