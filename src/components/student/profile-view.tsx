"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import {
  User,
  Camera,
  Shield,
  Copy,
  Check,
  LogOut,
  Star,
  ArrowRight,
  Clock,
  CreditCard,
  Mail,
  Award,
  MessageSquare,
  LayoutGrid,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { signOutAction } from "@/server/actions/auth";

export interface ProfileViewProps {
  profile: {
    id: string;
    full_name: string | null;
    college_id: string | null;
    role: string;
    is_active: boolean;
  };
  email: string;
  ordersCount: number;
  recentOrders?: Array<{
    id: string;
    order_code: number;
    status: string;
    placed_at: string;
    total_paise: number;
    items_summary: string;
  }>;
  themeToggleSection?: React.ReactNode;
}

export function ProfileView({
  profile,
  email,
  ordersCount,
  recentOrders = [],
  themeToggleSection,
}: ProfileViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "sso" | "feedback">("overview");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const collegeIdDisplay = profile.college_id || "CS2024002";
  const fullNameDisplay = profile.full_name || "Campus Member";

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Please select a valid image file");
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setAvatarUrl(event.target?.result as string);
        toast.success("Profile photo updated!");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCopy = (text: string, fieldName: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast.success(`Copied ${label} to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {/* =========================================================================
          1. TITLE SECTION
          ========================================================================= */}
      <section data-purpose="title-section">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#1c1c17] dark:text-[#f4f0e8]">
          Your Profile
        </h1>
      </section>

      {/* =========================================================================
          2. DIGITAL STUDENT ID PASS (APPLE WALLET / NEO-FINTECH ELEVATION)
          ========================================================================= */}
      <div
        className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#5c0d08] via-[#480806] to-[#260202] text-white p-6 sm:p-7 min-h-[215px] flex flex-col justify-between shadow-[0_16px_40px_-8px_rgba(78,6,6,0.38),0_4px_12px_rgba(0,0,0,0.12)] border border-white/20 select-none group transition-all"
        data-purpose="digital-id-pass"
      >
        {/* Holographic Sheen & Geometric Radial Accents */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255, 218, 214, 0.15) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,218,214,0.06) 45%, rgba(255,136,67,0.15) 75%, rgba(255,255,255,0.22) 100%)",
          }}
        />
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-gradient-to-br from-[#ff8843]/20 to-transparent blur-2xl pointer-events-none" />
        <div className="absolute -right-8 -bottom-10 w-44 h-44 rounded-full border-[12px] border-white/[0.04] pointer-events-none flex items-center justify-center">
          <span className="text-7xl font-black text-white/[0.05]">@</span>
        </div>

        {/* Student Identity Row */}
        <div className="relative z-10 flex items-center gap-4 my-auto pt-3 pb-3">
          {/* Avatar with Camera Icon Overlay & Verified Badge */}
          <div className="relative group/avatar flex-shrink-0">
            {/* Hidden native file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              aria-label="Upload profile photo"
            />

            <button
              type="button"
              onClick={handlePhotoClick}
              className="w-18 h-18 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-inner relative overflow-hidden group/btn cursor-pointer active:scale-95 transition-transform"
              title="Click to upload profile photo"
              aria-label="Upload profile photo"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={fullNameDisplay}
                  className="w-full h-full object-cover rounded-2xl"
                />
              ) : (
                <User className="w-9 h-9 sm:w-10 sm:h-10 text-[#ffdad6]" />
              )}

              {/* Hover / Tap Overlay */}
              <div className="absolute inset-0 bg-black/60 backdrop-blur-xs opacity-0 group-hover/btn:opacity-100 flex flex-col items-center justify-center text-white transition-opacity duration-200">
                <Camera className="w-5 h-5 text-white" />
                <span className="text-[9px] font-bold mt-1 tracking-wider uppercase font-mono">
                  {avatarUrl ? "Change" : "Upload"}
                </span>
              </div>
            </button>

            {/* Verified Checkmark Badge (Bottom-Right) */}
            <div
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#480806] flex items-center justify-center shadow-md pointer-events-none"
              title="Verified Student ID"
            >
              <svg
                className="w-3.5 h-3.5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M5 13l4 4L19 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                />
              </svg>
            </div>

            {/* Cool Camera Upload Action Button (Top-Right) */}
            <button
              type="button"
              onClick={handlePhotoClick}
              className="absolute -top-2 -right-2 w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full bg-gradient-to-tr from-[#ffdad6] via-white to-white text-[#4e0606] border-2 border-[#480806] flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all cursor-pointer z-20 group/cam"
              title="Upload profile photo"
              aria-label="Upload profile photo"
            >
              <Camera className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#4e0606] stroke-[2.2] transition-transform group-hover/cam:rotate-12" />
            </button>
          </div>

          {/* Identity Details */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-tight truncate font-headline">
                {fullNameDisplay}
              </h2>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs sm:text-sm text-[#ffdad6]/90">
              <span className="font-bold tracking-wide">ID: {collegeIdDisplay}</span>
            </div>
          </div>
        </div>

        {/* Card Bottom Strip with Micro Barcode Strip */}
        <div className="relative z-10 mt-4 pt-3.5 border-t border-white/15 flex items-center justify-between text-[11px] text-[#ffdad6]/80 font-mono">
          <div className="flex items-center gap-2.5">
            {/* Barcode micro-strip accent */}
            <div
              className="w-16 h-5 text-[#ffdad6]/70 rounded-xs"
              style={{
                background:
                  "repeating-linear-gradient(90deg, currentColor 0, currentColor 2px, transparent 2px, transparent 4px, currentColor 4px, currentColor 7px, transparent 7px, transparent 9px, currentColor 9px, currentColor 10px)",
              }}
              title={`Barcode ${collegeIdDisplay}`}
            />
            <span className="text-[11px] font-bold text-[#ffdad6]/80 uppercase tracking-wider">
              {profile.college_id ? `CS-${profile.college_id}` : "CS-2024-ID"}
            </span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          3. INTERACTIVE SEGMENTED TABS STRIP (OVERVIEW / SSO / FEEDBACK)
          ========================================================================= */}
      <div className="flex items-center p-1 bg-[#ece8e0] dark:bg-[#16171E] rounded-2xl border border-[#e6e2da] dark:border-[#222533] gap-1 shadow-inner text-xs font-bold font-mono">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex-1 py-2 px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "overview"
              ? "bg-[#ffffff] dark:bg-[#202330] text-[#6c1d18] dark:text-[#FBBF24] shadow-sm border border-[#e6e2da] dark:border-[#2D3142]"
              : "text-[#564240] dark:text-stone-400 hover:text-[#1c1c17] dark:hover:text-white"
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="truncate">Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("sso")}
          className={`flex-1 py-2 px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "sso"
              ? "bg-[#ffffff] dark:bg-[#202330] text-[#6c1d18] dark:text-[#FBBF24] shadow-sm border border-[#e6e2da] dark:border-[#2D3142]"
              : "text-[#564240] dark:text-stone-400 hover:text-[#1c1c17] dark:hover:text-white"
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="truncate">SSO</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("feedback")}
          className={`flex-1 py-2 px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "feedback"
              ? "bg-[#ffffff] dark:bg-[#202330] text-[#6c1d18] dark:text-[#FBBF24] shadow-sm border border-[#e6e2da] dark:border-[#2D3142]"
              : "text-[#564240] dark:text-stone-400 hover:text-[#1c1c17] dark:hover:text-white"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="truncate">
            Feedback {ordersCount > 0 ? `(${ordersCount})` : ""}
          </span>
        </button>
      </div>

      {/* =========================================================================
          4. STAT PILLS ROW (DINING PASS & TOTAL ORDERS)
          ========================================================================= */}
      {(activeTab === "overview" || activeTab === "feedback") && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-[#f1ede6] dark:bg-[#121319] rounded-xl p-3 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#ffdad6]/60 dark:bg-[#2a1412] text-[#6c1d18] dark:text-[#ffb4ab] flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase text-[#89726f] dark:text-stone-400 font-semibold tracking-wider">
                Pre-Order Pass
              </div>
              <div className="text-sm font-black font-mono text-[#6c1d18] dark:text-[#ffdad6] mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Active
              </div>
            </div>
          </div>

          <Link
            href="/orders"
            className="bg-[#f1ede6] dark:bg-[#121319] hover:bg-[#eae6de] dark:hover:bg-[#181a24] transition-colors rounded-xl p-3 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex items-center gap-3 group"
          >
            <div className="w-9 h-9 rounded-lg bg-[#ffdbcb] dark:bg-[#2a1a12] text-[#9e4300] dark:text-[#FBBF24] flex items-center justify-center flex-shrink-0">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase text-[#89726f] dark:text-stone-400 font-semibold tracking-wider">
                Total Orders
              </div>
              <div className="text-sm font-black font-mono text-[#9e4300] dark:text-[#FBBF24] mt-0.5">
                {ordersCount} {ordersCount === 1 ? "Order" : "Orders"}
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* =========================================================================
          5. BENTO GRID OF CREDENTIALS & SECURITY
          ========================================================================= */}
      {(activeTab === "overview" || activeTab === "sso") && (
        <div className="grid grid-cols-2 gap-3" data-purpose="user-account-details">
          {/* Card 1: College ID */}
          <div className="col-span-1 bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#564240] dark:text-stone-400 font-mono">
                  College ID
                </span>
                <CreditCard className="w-4 h-4 text-[#6c1d18] dark:text-[#ffb4ab]" />
              </div>
              <div className="text-base font-bold font-mono text-[#1c1c17] dark:text-white tracking-tight mt-1 truncate">
                {collegeIdDisplay}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between pt-2 border-t border-[#e6e2da]/70 dark:border-[#222533]">
              <span className="text-[10px] text-[#89726f] dark:text-stone-400">
                Card Holder
              </span>
              <button
                type="button"
                onClick={() => handleCopy(collegeIdDisplay, "college_id", "College ID")}
                className="text-xs text-[#6c1d18] dark:text-[#ffb4ab] hover:text-[#4e0606] font-semibold flex items-center gap-1 p-1 hover:bg-[#ffdad6]/40 dark:hover:bg-white/10 rounded-lg transition-colors active:scale-95 cursor-pointer"
                aria-label="Copy College ID"
                title="Copy College ID"
              >
                {copiedField === "college_id" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Card 2: Security Layer */}
          <div className="col-span-1 bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#564240] dark:text-stone-400 font-mono block mb-1">
                Security Layer
              </span>
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#00432c] dark:text-emerald-400 mt-0.5">
                <Shield className="w-4 h-4 text-[#00432c] dark:text-emerald-400 flex-shrink-0" />
                <span className="leading-tight">RBAC &amp; RLS</span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-[#e6e2da]/70 dark:border-[#222533] flex items-center justify-between">
              <span className="text-[10px] text-[#00432c] dark:text-emerald-300 font-semibold bg-emerald-100/60 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-400/30">
                Verified
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
          </div>

          {/* Card 3: Role & Dining Permissions */}
          <div className="col-span-2 bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#ffdbcb] dark:bg-[#2a1a12] text-[#9e4300] dark:text-[#FBBF24] flex items-center justify-center font-bold shadow-xs flex-shrink-0">
                <Award className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#564240] dark:text-stone-400 font-mono">
                    Role
                  </span>
                  <span className="w-1 h-1 rounded-full bg-stone-400" />
                  <span className="text-xs font-bold text-[#1c1c17] dark:text-white capitalize">
                    {profile.role}
                  </span>
                </div>
                <p className="text-[11px] text-[#564240] dark:text-stone-400 mt-0.5 leading-tight truncate">
                  Meal Pre-Order Access &amp; Dining Hall Permissions
                </p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[#e6e2da] dark:bg-[#1f2230] px-2 py-1 rounded-lg text-[#564240] dark:text-stone-300 border border-[#dcc0bd] dark:border-[#2d3142]">
                Authorized
              </span>
            </div>
          </div>

          {/* Card 4: Campus Account & SSO Module */}
          <div className="col-span-2 bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#564240] dark:text-stone-400 font-mono flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-[#9e4300] dark:text-[#FBBF24]" />
                Campus Account &amp; Login Email
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-100/80 dark:bg-emerald-950/80 px-2 py-0.5 rounded font-mono border border-emerald-400/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Single Sign-On
              </span>
            </div>

            <div className="bg-[#ffffff] dark:bg-[#181a24] rounded-xl p-3 border border-[#e6e2da] dark:border-[#262836] flex items-center justify-between shadow-2xs">
              <div className="space-y-0.5 overflow-hidden pr-2">
                <div className="text-[10px] text-[#89726f] dark:text-stone-400 font-mono uppercase tracking-wider">
                  Institutional Email
                </div>
                <div className="text-xs font-bold font-mono text-[#1c1c17] dark:text-white truncate tracking-tight">
                  {email || "student@campus.edu"}
                </div>
              </div>

              <div className="flex items-center gap-2 pl-2 flex-shrink-0 border-l border-[#e6e2da] dark:border-[#262836]">
                <div className="text-right">
                  <div className="text-[9px] text-[#89726f] dark:text-stone-400 font-mono uppercase">
                    User ID
                  </div>
                  <div className="text-xs font-bold font-mono text-[#6c1d18] dark:text-[#ffb4ab]">
                    {profile.college_id || profile.id.slice(0, 8)}
                  </div>
                </div>
                {email && (
                  <button
                    type="button"
                    onClick={() => handleCopy(email, "email", "Email")}
                    className="w-8 h-8 rounded-xl bg-[#f1ede6] dark:bg-[#1f2230] flex items-center justify-center text-[#6c1d18] dark:text-[#ffb4ab] hover:text-[#4e0606] transition-colors border border-[#e6e2da] dark:border-[#262836] active:scale-95 cursor-pointer shadow-xs"
                    aria-label="Copy Email"
                    title="Copy Email"
                  >
                    {copiedField === "email" ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. THEME & APPEARANCE CONTROL CARD
          ========================================================================= */}
      {themeToggleSection ? (
        themeToggleSection
      ) : (
        <section
          className="bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex items-center justify-between"
          data-purpose="theme-toggle"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1c1c17] dark:bg-[#1e2230] text-[#ff8843] dark:text-[#FBBF24] flex items-center justify-center shadow-xs">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 20 20">
                <path
                  clipRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  fillRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-[#1c1c17] dark:text-white text-sm leading-snug">
                Theme & Appearance
              </h3>
              <p className="text-[11px] text-[#564240] dark:text-stone-400 mt-0.5 leading-snug">
                Switch between Light and Dark mode for C@mpBite.
              </p>
            </div>
          </div>
          <ThemeToggle />
        </section>
      )}

      {/* =========================================================================
          7. RATE PRE-ORDER EXPERIENCE HERO ACTION (HIGH DELIGHT HIGHLIGHT CARD)
          ========================================================================= */}
      {(activeTab === "overview" || activeTab === "feedback") && (
        <div
          className="bg-gradient-to-br from-[#fff7f4] via-[#fdf2ee] to-[#ffebdf] dark:from-[#1b1211] dark:via-[#161214] dark:to-[#1e1311] rounded-2xl p-4 border border-[#ffdad6] dark:border-[#381e1a] shadow-xs flex flex-col gap-3 group relative overflow-hidden"
          data-purpose="preorder-feedback-action"
        >
          <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-[#ff8843]/10 pointer-events-none blur-xl" />

          <div className="flex items-start justify-between gap-2 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#ffdad6] dark:bg-[#311512] text-[#4e0606] dark:text-[#ffb4ab] flex items-center justify-center font-bold shadow-xs flex-shrink-0 group-hover:scale-105 transition-transform border border-[#ffb4ab] dark:border-[#4d201c]">
                <Star className="w-6 h-6 text-[#6c1d18] dark:text-[#FBBF24] fill-amber-400" />
              </div>
              <div>
                <h3 className="font-bold text-[#1c1c17] dark:text-white text-sm leading-snug">
                  Rate Pre-Order Experience
                </h3>
                <p className="text-[11px] text-[#564240] dark:text-stone-400 mt-0.5 leading-snug">
                  Tell us how your food pickup &amp; dining went
                </p>
              </div>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#9e4300] dark:text-[#FBBF24] bg-[#ffdbcb] dark:bg-[#2b1812] px-2 py-0.5 rounded-full font-mono flex-shrink-0 border border-[#ffb690] dark:border-[#4a2618]">
              Pre-Order
            </span>
          </div>

          {/* Prominent Action Button */}
          <Link
            href="/orders"
            className="relative z-10 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#6c1d18] to-[#4e0606] hover:from-[#591612] hover:to-[#3b0404] text-white text-xs font-bold flex items-center justify-between transition-all active:scale-[0.98] shadow-md group/btn cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="text-amber-300">★</span>
              <span>Rate Pickup &amp; Food Quality</span>
            </span>
            <div className="flex items-center gap-1.5 text-[#ffdad6] group-hover/btn:translate-x-1 transition-transform">
              <span className="text-[11px] font-semibold font-mono">Give Feedback</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </Link>
        </div>
      )}

      {/* =========================================================================
          8. FEEDBACK & ORDER HISTORY SECTION
          ========================================================================= */}
      {(activeTab === "overview" || activeTab === "feedback") && (
        <section
          className="bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-4 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex flex-col gap-3"
          data-purpose="feedback-history-section"
        >
          <div className="flex items-center justify-between pb-2 border-b border-[#e6e2da]/70 dark:border-[#222533]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#9e4300] dark:text-[#FBBF24]" />
              <h3 className="font-bold text-[#1c1c17] dark:text-white text-sm leading-none">
                Feedback &amp; Orders History
              </h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#564240] dark:text-stone-400 font-mono bg-[#e6e2da] dark:bg-[#1f2230] px-2 py-0.5 rounded-full border border-[#dcc0bd] dark:border-[#2d3142]">
              {recentOrders.length > 0
                ? `Recent • ${ordersCount} Total`
                : "Recent"}
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {recentOrders.length > 0 ? (
              recentOrders.map((ord) => (
                <Link
                  key={ord.id}
                  href={`/orders/${ord.id}`}
                  className="bg-[#ffffff] dark:bg-[#181a24] rounded-xl p-3 border border-[#e6e2da] dark:border-[#262836] flex flex-col gap-2 hover:border-[#dcc0bd] dark:hover:border-[#3d4255] transition-colors shadow-2xs group"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <div className="text-xs font-bold text-[#1c1c17] dark:text-white group-hover:text-[#6c1d18] dark:group-hover:text-[#FBBF24] transition-colors">
                        Order #{ord.order_code} – {ord.items_summary || "Campus Meal"}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-amber-500">
                        <span>★★★★★</span>
                        <span className="text-[10px] font-bold text-[#564240] dark:text-stone-400 font-mono ml-0.5">
                          Verified
                        </span>
                      </div>
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-100/80 dark:bg-emerald-950/80 border border-emerald-400/30 px-2 py-0.5 rounded-md font-mono">
                      {ord.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#564240] dark:text-stone-400 pt-1.5 border-t border-[#e6e2da]/70 dark:border-[#262836]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-[#6c1d18] dark:text-[#ffb4ab] bg-[#ffdad6]/60 dark:bg-[#2c1514] px-2 py-0.5 rounded font-mono">
                        Pickup Pass
                      </span>
                      <span className="font-medium text-[#6c1d18] dark:text-[#ffb4ab] bg-[#ffdad6]/60 dark:bg-[#2c1514] px-2 py-0.5 rounded font-mono">
                        Quick Service
                      </span>
                    </div>
                    <span className="text-[#89726f] dark:text-stone-400 font-mono whitespace-nowrap ml-2">
                      {new Date(ord.placed_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="bg-[#ffffff] dark:bg-[#181a24] rounded-xl p-4 border border-dashed border-[#e6e2da] dark:border-[#262836] text-center space-y-1.5">
                <p className="text-xs font-semibold text-[#1c1c17] dark:text-white">
                  No orders yet
                </p>
                <p className="text-[11px] text-[#89726f] dark:text-stone-400">
                  Pre-order meals from the campus menu to see verified review items here.
                </p>
              </div>
            )}
          </div>

          {/* Archive Link */}
          <Link
            href="/orders"
            className="mt-0.5 text-center py-1.5 text-xs font-semibold text-[#6c1d18] dark:text-[#ffb4ab] hover:text-[#4e0606] dark:hover:text-white flex items-center justify-center gap-1 transition-colors group/link cursor-pointer"
          >
            <span>View Full Order History &amp; Feedback</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover/link:translate-x-1 transition-transform" />
          </Link>
        </section>
      )}

      {/* =========================================================================
          9. SIGN OUT BUTTON
          ========================================================================= */}
      <div className="pt-2">
        <form action={signOutAction} className="w-full">
          <button
            type="submit"
            className="w-full py-3.5 px-4 rounded-2xl border border-[#dcc0bd] dark:border-[#3a2222] bg-[#ffffff] dark:bg-[#181a24] hover:bg-[#ffdad6]/30 dark:hover:bg-[#2d1414] active:bg-[#ffdad6]/60 transition-all flex items-center justify-center gap-2.5 text-[#ba1a1a] dark:text-[#ff6b6b] font-bold text-sm shadow-xs group active:scale-[0.98] cursor-pointer"
          >
            <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1 text-[#ba1a1a] dark:text-[#ff6b6b]" />
            <span>Sign Out</span>
          </button>
        </form>
      </div>

      {/* =========================================================================
          10. FOOTER
          ========================================================================= */}
      <footer
        className="mt-4 pt-3 border-t border-[#e6e2da] dark:border-[#222533] text-center"
        data-purpose="copyright-footer"
      >
        <p className="text-[11px] text-[#89726f] dark:text-stone-400 font-medium font-mono">
          &copy; {new Date().getFullYear()} C
          <span className="text-[#6c1d18] dark:text-[#ffb4ab] font-bold">@</span>
          mpBite &bull; Smart Pre-Order System
        </p>
      </footer>
    </div>
  );
}
