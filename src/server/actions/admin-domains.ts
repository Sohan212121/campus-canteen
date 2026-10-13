"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";

export type AllowedDomainItem = {
  id: string;
  domain: string;
  created_at: string;
  created_by: string | null;
  creator_name: string | null;
};

export type AdminActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; isFreemailWarning?: boolean };

const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const domainInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Domain name is too short")
  .max(100, "Domain name is too long")
  .refine((d) => !d.includes("@"), "Domain must not contain '@'")
  .refine((d) => !d.endsWith("."), "Domain must not end with a dot")
  .refine((d) => domainRegex.test(d), "Invalid domain name format");

export async function adminListAllowedDomainsAction(): Promise<AdminActionResult<AllowedDomainItem[]>> {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_allowed_domains");

  if (error) {
    return {
      success: false,
      error: "Failed to load allowed domains.",
      code: "FETCH_FAILED",
    };
  }

  return { success: true, data: (data as AllowedDomainItem[]) || [] };
}

export async function adminAddAllowedDomainAction(
  domain: string,
  confirmFreemail: boolean = false
): Promise<AdminActionResult<{ id?: string; domain: string; changed: boolean }>> {
  await requireRole(["admin"]);

  const parsed = domainInputSchema.safeParse(domain);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid domain format",
      code: "INVALID_INPUT",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_add_allowed_domain", {
    p_domain: parsed.data,
    p_confirm_freemail: confirmFreemail,
  });

  if (error) {
    const rawMsg = error.message || "";
    if (rawMsg.includes("PUBLIC_SUFFIX_CONFIRMATION_REQUIRED")) {
      return {
        success: false,
        error: `${parsed.data} is a public top-level or second-level suffix (e.g. ac.in, edu.in, edu), not an institution domain. Did you mean campus.${parsed.data}? Confirm explicitly if you truly wish to allow this root suffix.`,
        code: "PUBLIC_SUFFIX_CONFIRMATION_REQUIRED",
        isFreemailWarning: true,
      };
    }
    if (rawMsg.includes("FREEMAIL_CONFIRMATION_REQUIRED")) {
      return {
        success: false,
        error: `${parsed.data} is a public consumer email provider (e.g. Gmail/Yahoo). Are you sure you want to permit self-registration for this public domain?`,
        code: "FREEMAIL_CONFIRMATION_REQUIRED",
        isFreemailWarning: true,
      };
    }
    if (rawMsg.includes("INVALID_INPUT")) {
      return {
        success: false,
        error: rawMsg.replace(/^[A-Z_]+:\s*/, ""),
        code: "INVALID_INPUT",
      };
    }
    return {
      success: false,
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to add domain.",
      code: "ADD_FAILED",
    };
  }

  revalidatePath("/admin/domains");
  const res = data as { id?: string; domain: string; changed: boolean };
  return { success: true, data: res };
}

export async function adminRemoveAllowedDomainAction(
  domain: string
): Promise<AdminActionResult<{ domain: string; changed: boolean }>> {
  await requireRole(["admin"]);

  const parsed = domainInputSchema.safeParse(domain);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid domain format.",
      code: "INVALID_INPUT",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_remove_allowed_domain", {
    p_domain: parsed.data,
  });

  if (error) {
    const rawMsg = error.message || "";
    return {
      success: false,
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to remove domain.",
      code: "REMOVE_FAILED",
    };
  }

  revalidatePath("/admin/domains");
  const res = data as { domain: string; changed: boolean };
  return { success: true, data: res };
}
