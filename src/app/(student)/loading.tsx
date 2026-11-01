"use client";

import { usePathname } from "next/navigation";
import { LogoTransition } from "@/components/ui/logo-transition";
import { HealthyLogoTransition } from "@/components/ui/healthy-logo-transition";

export default function StudentLoading() {
  const pathname = usePathname();

  // Strict check: if navigating to or on any healthy mode route, NEVER render old cutlery transition
  const isHealthy =
    pathname?.startsWith("/healthy") ||
    (typeof window !== "undefined" &&
      (window.location.pathname.startsWith("/healthy") ||
        document.documentElement.getAttribute("data-transition-theme") === "healthy" ||
        document.body.getAttribute("data-transition-target")?.startsWith("/healthy")));

  if (isHealthy) {
    return (
      <HealthyLogoTransition
        destinationLabel={pathname?.includes("score") ? "Healthy Score Guide" : "Healthy Mode"}
      />
    );
  }

  return <LogoTransition destinationLabel="Campus Dining" />;
}
