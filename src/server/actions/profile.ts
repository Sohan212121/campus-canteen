"use server";

import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";
import {
  isValidAvatarPath,
  validateImageMagicBytes,
  MAX_AVATAR_SIZE_BYTES,
} from "@/lib/avatar-utils";

const SaveAvatarSchema = z.object({
  path: z.string().min(1).max(120),
});

export type SaveAvatarResult =
  | { success: true; avatarUrl: string | null }
  | { success: false; error: string };

export type RemoveAvatarResult =
  | { success: true }
  | { success: false; error: string };

export type GetAvatarUrlResult =
  | { success: true; avatarUrl: string | null }
  | { success: false; error: string };

/**
 * Server action to save a newly uploaded avatar path for the authenticated student.
 *
 * Guarantees:
 * 1. Caller must be an authenticated student.
 * 2. Path shape must match `<user-id>/<filename>.<ext>` and pass strict validation.
 * 3. Inspects the uploaded storage object's first bytes server-side for valid magic bytes
 *    (JPEG, PNG, WebP) and verifies length <= 1 MB.
 * 4. If verification fails, deletes the uploaded object and does not modify the DB.
 * 5. If saving the path to the DB fails, deletes the new storage object.
 * 6. On replacement, updates the database path first, then deletes the old storage object.
 * 7. Returns a fresh 1-hour signed URL on success.
 */
export async function saveAvatarPathAction(input: {
  path: string;
}): Promise<SaveAvatarResult> {
  const user = await requireRole(["student"]);

  const parsed = SaveAvatarSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid avatar path format." };
  }

  const { path } = parsed.data;

  // Verify path belongs to caller and matches safe pattern
  if (!isValidAvatarPath(path, user.id)) {
    return { success: false, error: "Unauthorized avatar path." };
  }

  const supabase = await createClient();

  // 1. Download uploaded object to inspect size and magic bytes server-side
  const { data: blob, error: downloadError } = await supabase.storage
    .from("avatars")
    .download(path);

  if (downloadError || !blob) {
    // Delete file if reachable and abort
    await supabase.storage.from("avatars").remove([path]);
    return {
      success: false,
      error: "Uploaded photo could not be verified. Please try again.",
    };
  }

  // Check size bound (<= 1 MB)
  if (blob.size === 0 || blob.size > MAX_AVATAR_SIZE_BYTES) {
    await supabase.storage.from("avatars").remove([path]);
    return {
      success: false,
      error: "Photo exceeds the maximum allowed size of 1 MB.",
    };
  }

  // Check magic bytes (JPEG, PNG, or WebP)
  const arrayBuffer = await blob.arrayBuffer();
  const detectedMime = validateImageMagicBytes(arrayBuffer);
  if (!detectedMime) {
    await supabase.storage.from("avatars").remove([path]);
    return {
      success: false,
      error: "The uploaded file is not a valid JPEG, PNG or WebP image.",
    };
  }

  // 2. Fetch current avatar_path to enable safe replacement
  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .single();

  const oldPath = currentProfile?.avatar_path ?? null;

  // 3. Save new path in the database first
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", user.id);

  if (updateError) {
    // If DB update fails, delete the new object to prevent orphans
    await supabase.storage.from("avatars").remove([path]);
    return {
      success: false,
      error: "Failed to update profile. Please try again.",
    };
  }

  // 4. On successful DB save, clean up the old storage object if replaced
  if (oldPath && oldPath !== path) {
    try {
      await supabase.storage.from("avatars").remove([oldPath]);
    } catch (cleanupErr) {
      console.error("Failed to delete previous avatar from storage:", cleanupErr);
    }
  }

  // 5. Generate a fresh 1-hour signed URL
  const { data: signedData } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 3600);

  return {
    success: true,
    avatarUrl: signedData?.signedUrl ?? null,
  };
}

/**
 * Server action to remove the student's current profile photo.
 *
 * Guarantees:
 * 1. Caller must be an authenticated student.
 * 2. Database path is cleared first (avatar_path = NULL).
 * 3. Deletion of the storage object is attempted; even if storage delete fails,
 *    the database path remains cleared and an error is logged.
 */
export async function removeAvatarAction(): Promise<RemoveAvatarResult> {
  const user = await requireRole(["student"]);
  const supabase = await createClient();

  // 1. Fetch current path
  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .single();

  const currentPath = currentProfile?.avatar_path ?? null;

  // 2. Clear path in database
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", user.id);

  if (updateError) {
    return { success: false, error: "Failed to remove avatar from profile." };
  }

  // 3. Attempt to delete storage object
  if (currentPath) {
    try {
      await supabase.storage.from("avatars").remove([currentPath]);
    } catch (deleteErr) {
      console.error("Failed to delete avatar from storage:", deleteErr);
    }
  }

  return { success: true };
}

/**
 * Server action to fetch a fresh 1-hour signed URL for the student's avatar.
 * Used on app resume or when an existing signed URL expires.
 */
export async function getStudentAvatarUrlAction(): Promise<GetAvatarUrlResult> {
  const user = await requireRole(["student"]);
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .single();

  if (!profile?.avatar_path) {
    return { success: true, avatarUrl: null };
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from("avatars")
    .createSignedUrl(profile.avatar_path, 3600);

  if (signError || !signedData?.signedUrl) {
    return { success: true, avatarUrl: null };
  }

  return { success: true, avatarUrl: signedData.signedUrl };
}

