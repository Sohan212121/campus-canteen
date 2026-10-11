"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid("Invalid notification ID");

export type NotificationItem = {
  id: string;
  user_id: string;
  order_id: string | null;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

export type GetNotificationsResult = {
  success: boolean;
  error?: string;
  notifications: NotificationItem[];
  unreadCount: number;
};

/**
 * Retrieves in-app notifications for the authenticated user with unread tally.
 */
export async function getNotificationsAction(limit = 40): Promise<GetNotificationsResult> {
  await requireRole(["student"]);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, user_id, order_id, title, body, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to load notifications.",
      notifications: [],
      unreadCount: 0,
    };
  }

  const notifications = data as NotificationItem[];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    success: true,
    notifications,
    unreadCount,
  };
}

/**
 * Marks a single notification as read.
 * Governed strictly by RLS and column-level grant: only alters is_read on user's own rows.
 */
export async function markNotificationReadAction(notificationId: string): Promise<{ success: boolean; error?: string }> {
  await requireRole(["student"]);

  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) {
    return { success: false, error: "Invalid notification ID." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", parsed.data);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/notifications", "page");
  return { success: true };
}

/**
 * Marks all unread notifications as read for the authenticated user.
 */
export async function markAllNotificationsReadAction(): Promise<{ success: boolean; error?: string }> {
  await requireRole(["student"]);

  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("is_read", false);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/notifications", "page");
  return { success: true };
}
