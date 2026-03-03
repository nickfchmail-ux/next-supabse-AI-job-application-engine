"use server";

import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  // List all files in bucket and find one matching this user
  const { data: files, error } = await supabase.storage.from(BUCKET).list("", {
    search: `${userId}-resume`,
  });

  if (error) return { ok: false, error: error.message };

  const match = files?.find((f) => f.name.startsWith(`${userId}-resume`));

  if (!match) {
    return { ok: true, userId, fileName: null, signedUrl: null };
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(match.name, 60 * 60); // 1h

  if (signErr || !signed) {
    return { ok: true, userId, fileName: match.name, signedUrl: null };
  }

  return {
    ok: true,
    userId,
    fileName: match.name,
    signedUrl: signed.signedUrl,
  };
}

export type UploadResumeResult = { ok: true } | { ok: false; error: string };

export async function uploadResumeAction(
  formData: FormData,
): Promise<UploadResumeResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

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

  // Delete any existing resume for this user first (handles extension changes)
  const { data: existing } = await supabase.storage.from(BUCKET).list("", {
    search: `${userId}-resume`,
  });
  const old = existing?.find((f) => f.name.startsWith(`${userId}-resume`));
  if (old && old.name !== newName) {
    await supabase.storage.from(BUCKET).remove([old.name]);
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
