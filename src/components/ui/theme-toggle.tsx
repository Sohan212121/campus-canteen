"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

const emptySubscribe = () => () => {};

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={cn(
        "group/theme relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-[#181615] border border-[#443b35] text-[#efe3cb] hover:text-[#ffb94e] hover:border-[#fe7543]/70 active:scale-95 cursor-pointer shadow-sm select-none transition-colors",
        className
      )}
      aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
      title={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
    >
      {/* Sun icon for Light mode */}
      <Sun className="h-4 w-4 sm:h-5 sm:w-5 rotate-0 scale-100 transition-all duration-300 text-amber-500 dark:-rotate-90 dark:scale-0" />
      {/* Moon icon for Dark mode */}
      <Moon className="absolute h-4 w-4 sm:h-5 sm:w-5 rotate-90 scale-0 transition-all duration-300 text-amber-400 dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
