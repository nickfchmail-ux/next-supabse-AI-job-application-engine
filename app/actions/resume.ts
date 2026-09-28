"use server";

import { getUserId } from "@/lib/auth";
import { requireServiceClient } from "@/lib/supabase";

const BUCKET = "resume";

export async function getResumeInfo(): Promise<
  | {
      ok: true;
      userId: string;
      fileName: string | null;
      signedUrl: string | null;
    }
  | { ok: false; error: string }
> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const supabase = requireServiceClient();

  // The resume filename is DETERMINISTIC (`${userId}-resume.${ext}`), so we
  // don't know the extension without listing. To avoid a bucket LIST on every
  // call (a storage-op cost on every profile render), probe the three allowed
  // extensions directly instead — each probe is a cheap HEAD against a known
  // path, not a full bucket scan.
  const candidates = ["pdf", "doc", "docx"].map(
    (ext) => `${userId}-resume.${ext}`,
  );

  // Try to find the existing file without a full bucket listing.
  for (const name of candidates) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(name, 60 * 60);
    if (!error && data?.signedUrl) {
      // A signed URL existing means the object exists — use it directly.
      return {
        ok: true,
        userId,
        fileName: name,
        signedUrl: data.signedUrl,
      };
    }
  }

  // No candidate matched. A scoped bucket LIST used to run here, but on this
  // project a LIST with a `search` filter fails with HTTP 544
  // `DatabaseTimeout`, so it is not a usable fallback — treat the user as
  // having no resume.
  return { ok: true, userId, fileName: null, signedUrl: null };
}

export type UploadResumeResult = { ok: true } | { ok: false; error: string };

export async function uploadResumeAction(
  formData: FormData,
): Promise<UploadResumeResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const supabase = requireServiceClient();

  const file = formData.get("resume") as File | null;
  if (!file || file.size === 0)
    return { ok: false, error: "No file selected." };

  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, error: "Only PDF, DOC, or DOCX files are allowed." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const newName = `${userId}-resume.${ext}`;

  // Delete any existing resume for this user first (handles extension changes).
  // Probe the deterministic candidate names directly: a storage LIST with a
  // `search` filter returns HTTP 544 `DatabaseTimeout` on this project, so a
  // bucket scan must not be used to find the existing resume.
  let knownSize: number | null = null;
  for (const name of ["pdf", "docx", "doc"].map(
    (ext) => `${userId}-resume.${ext}`,
  )) {
    // `info()` is a cheap metadata HEAD — no object body is transferred.
    let size: number | null = null;
    try {
      const { data: info, error: infoErr } = await supabase.storage
        .from(BUCKET)
        .info(name);
      if (infoErr || !info) continue;
      size = typeof info.size === "number" ? info.size : null;
    } catch {
      // `info()` unsupported on this storage version — treat as absent.
      continue;
    }

    if (name !== newName) {
      await supabase.storage.from(BUCKET).remove([name]);
      continue;
    }
    knownSize = size;
  }

  // ── Skip re-upload when the file is unchanged ──────────────────────
  // Same name AND a known matching size ⇒ the content is (almost certainly)
  // identical, so don't pay for the storage write again on every save click.
  // When the size is unknown we fall through and upload (safe default).
  if (knownSize !== null && knownSize === file.size) {
    return { ok: true };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(newName, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr) return { ok: false, error: uploadErr.message };

  return { ok: true };
}
