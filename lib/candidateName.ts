/**
 * Candidate-name extraction for DOWNLOAD NAMING.
 *
 * The user's name is not stored anywhere in our database — the ONLY place it
 * exists is inside the resume they uploaded, which the AI/LLM copies into the
 * generated document. So we recover the name from the document the preview
 * overlay ALREADY has loaded (no extra network request, no new storage read):
 *
 *   - resume      → the generated resume HTML (header `<h1>` / `<title>`)
 *   - cover letter → the generated cover-letter plain text (its first lines)
 *
 * The name is then used for the download file name and the document title,
 * e.g. `FONG CHUN HONG, NICK - RESUME.pdf`.
 *
 * NOTE: the name keeps its INTERNAL commas (`FONG CHUN HONG, NICK`) — the last
 * name follows the first name after a comma in Hong Kong convention. Only a
 * TRAILING document label (`..., NICK - RESUME`) is stripped.
 */

/** A document kind, as it appears in the file name / title. */
export type DocumentKind = "RESUME" | "COVER LETTER";

/**
 * Tidy a raw string into a candidate name, or return "" when it clearly is
 * not one (an email, a URL, a date, a section heading, a placeholder…).
 */
export function normalizeCandidateName(
  raw: string | null | undefined,
): string {
  let s = (raw ?? "")
    // Non-breaking / zero-width spaces look like real characters but are not.
    .replace(/[\u00a0\u200b\u200e\u200f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";

  // Drop a trailing document label: "NAME - RESUME", "NAME — CV", "NAME | Resume".
  s = s.replace(/\s*[-–—|·•]\s*(resume|curriculum vitae|cv)\s*$/i, "").trim();

  // Drop leading/trailing decoration, but KEEP internal commas and hyphens
  // (both are legitimate parts of a person's name).
  s = s
    .replace(/^[\s\-–—|·•:;,.]+/, "")
    .replace(/[\s\-–—|·•:;]+$/, "")
    .trim();

  // Reject obvious non-names.
  if (s.length < 2 || s.length > 80) return "";
  if (/[@<>/\\]|https?:|www\./i.test(s)) return "";
  if (/^(your|my|the)\s+name$/i.test(s)) return "";
  // A document label or placeholder on its own is not a name.
  if (/^(resume|curriculum vitae|cv|candidate|applicant)$/i.test(s)) return "";
  // Must contain at least one letter (Latin or CJK).
  if (!/[a-z\u4e00-\u9fff]/i.test(s)) return "";
  // A contact line ("+852 5108 0579", "linkedin.com/in/…") is not a name.
  if (/\d{3,}/.test(s)) return "";
  // A heading ("PROFESSIONAL SUMMARY", "WORK EXPERIENCE") is not a name.
  if (
    /^(summary|profile|about|skills?|technologies?|experience|work experience|employment|education|academics?|certifications?|courses?|languages?|projects?|awards?|interests?)\b/i.test(
      s,
    )
  ) {
    return "";
  }

  return s;
}

/** The first non-empty line of a container element (avoid joining siblings). */
function firstLineOf(el: Element): string {
  const own = el.firstElementChild?.textContent ?? el.textContent ?? "";
  return own.split(/\r?\n/)[0] ?? own;
}

/**
 * Recover the candidate's name from the generated RESUME HTML.
 *
 * Order of preference:
 *   1. `<h1>`         — the resume's own name heading (the canonical spot)
 *   2. `<title>`      — the document title we stamp (`{NAME} - RESUME`)
 *   3. a name/header block (`[class*="name"]`, `[class*="header"]`, `<header>`)
 *   4. the first few top-level blocks in the body
 *
 * `<h1>` is checked FIRST because it is the resume's own name heading, whereas
 * a `<title>` could be a generic label ("Tailored Resume") on an older file.
 */
export function candidateNameFromResumeHtml(html: string | null): string {
  if (!html || typeof DOMParser === "undefined") return "";

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return "";
  }

  const fromH1 = normalizeCandidateName(doc.querySelector("h1")?.textContent);
  if (fromH1) return fromH1;

  const fromTitle = normalizeCandidateName(doc.querySelector("title")?.textContent);
  if (fromTitle) return fromTitle;

  const blocks = doc.querySelectorAll(
    '[class*="name" i], [class*="header" i], header',
  );
  for (const el of Array.from(blocks).slice(0, 3)) {
    const candidate = normalizeCandidateName(firstLineOf(el));
    if (candidate) return candidate;
  }

  const body = doc.body;
  if (body) {
    for (const el of Array.from(body.children).slice(0, 4)) {
      const candidate = normalizeCandidateName(firstLineOf(el));
      if (candidate) return candidate;
    }
  }

  return "";
}

/**
 * Rewrite the resume's `<h1>` heading to `title` (`FONG CHUN HONG, NICK -
 * RESUME`).
 *
 * Only a PLAIN-TEXT `<h1>` whose current text already IS the candidate's name
 * is touched, so a styled or unexpected heading is left exactly as generated.
 * Applying it to an already-correct heading is a no-op, because the trailing
 * document label is stripped before the comparison — which keeps this
 * idempotent with the copy the server stored.
 */
export function withResumeHeading(
  html: string | null | undefined,
  name: string,
  title: string,
): string | null {
  if (!html || !name || !title) return html ?? null;

  const re = /(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i;
  const match = html.match(re);
  if (!match || match.index === undefined) return html;
  // Nested markup means the heading is styled — don't flatten it to text.
  if (/<[a-z][\s\S]*>/i.test(match[2])) return html;

  const current = normalizeCandidateName(
    match[2].replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"),
  );
  if (!current || current.toLowerCase() !== name.toLowerCase()) return html;

  const escaped = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    html.slice(0, match.index) +
    match[1] +
    escaped +
    match[3] +
    html.slice(match.index + match[0].length)
  );
}

/**
 * Recover the candidate's name from a plain-text COVER LETTER.
 *
 * The letter prompt tells the model to use the candidate's real contact
 * details in the header and signature, so the name sits in one of the first
 * few lines — usually as `NAME · email · phone`. We stop at the salutation
 * ("Dear …") so we never mistake the greeting for the sender's name.
 */
export function candidateNameFromLetterText(text: string | null): string {
  if (!text) return "";

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 6)) {
    if (/^(dear\b|re:|subject:|to whom|hiring manager)/i.test(line)) break;
    if (line.includes("@")) continue;

    // A header line often joins name + contact with a separator — take the
    // first segment only.
    const firstSegment = line.split(/[·•|]|\s{2,}|\t/)[0] ?? "";
    const candidate = normalizeCandidateName(firstSegment);
    if (!candidate) continue;
    // A person's name is short; a paragraph is not.
    if (candidate.split(/\s+/).length > 5) continue;
    return candidate;
  }

  return "";
}

/**
 * Make a string safe to use as a file name on Windows, macOS and Linux.
 * Characters that are illegal in a path segment become "-".
 */
export function safeFileName(raw: string, fallback: string): string {
  const cleaned = (raw ?? "")
    // Illegal on Windows: \ / : * ? " < > |  plus control characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    // A trailing dot/space is dropped silently by Windows — strip it here so
    // the saved name matches what we asked for.
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();
  return cleaned || fallback;
}

/**
 * The document TITLE / base file name, e.g. `FONG CHUN HONG, NICK - RESUME`.
 *
 * Used both for `a.download` and for the printed document's `<title>` (the
 * browser derives its "Save as PDF" file name from that).
 *
 * When the name can't be recovered we fall back to the bare document kind
 * (`RESUME` / `COVER LETTER`) rather than inventing a placeholder name.
 */
export function documentTitle(name: string, kind: DocumentKind): string {
  const clean = safeFileName(name, "");
  return clean ? `${clean} - ${kind}` : kind;
}
