import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Brand Wordmark & Logo Transition Static Security & Style Audit", () => {
  const rootDir = process.cwd();
  const brandWordmarkPath = path.join(
    rootDir,
    "src",
    "components",
    "ui",
    "brand-wordmark.tsx"
  );
  const logoTransitionPath = path.join(
    rootDir,
    "src",
    "components",
    "ui",
    "logo-transition.tsx"
  );
  const studentHeaderPath = path.join(
    rootDir,
    "src",
    "components",
    "student",
    "student-header.tsx"
  );
  const healthyTransitionPath = path.join(
    rootDir,
    "src",
    "components",
    "ui",
    "healthy-logo-transition.tsx"
  );

  it("shared BrandWordmark uses official title PNGs with red @ preserved across themes", () => {
    expect(fs.existsSync(brandWordmarkPath)).toBe(true);
    const content = fs.readFileSync(brandWordmarkPath, "utf-8");

    // Must use ONLY existing title assets
    expect(content).toContain("/brand/campbite-title-light.png");
    expect(content).toContain("/brand/campbite-title-dark.png");

    // Must switch cleanly via standard dark: classes
    expect(content).toContain("dark:hidden");
    expect(content).toContain("hidden dark:block");

    // Must maintain accessible text
    expect(content).toContain('alt="C@MPBITE"');
    expect(content).toContain("sr-only");
    expect(content).toContain("C@mpBite");
  });

  it("LogoTransition uses shared BrandWordmark with exact timing, easing, and reduced-motion fallback", () => {
    expect(fs.existsSync(logoTransitionPath)).toBe(true);
    const content = fs.readFileSync(logoTransitionPath, "utf-8");

    // Must import and render BrandWordmark
    expect(content).toContain('import { BrandWordmark } from "@/components/ui/brand-wordmark"');
    expect(content).toContain("<BrandWordmark");

    // Old typewriter letter loop must be completely replaced
    expect(content).not.toContain("BRAND_LETTERS");
    expect(content).not.toContain("item.isSpecial");

    // Must keep entrance start at 260ms and duration at 410ms with cubic-bezier easing
    expect(content).toContain("260ms");
    expect(content).toContain("410ms");
    expect(content).toContain("cubic-bezier(0.34, 1.56, 0.64, 1)");

    // Must occupy the same box: mt-5, h-8 sm:h-9 reserved height
    expect(content).toContain("mt-5");
    expect(content).toContain("h-8 sm:h-9");

    // Overlay images must NOT have priority
    expect(content).toContain("priority={false}");

    // Under prefers-reduced-motion, must show instantly with no animation
    expect(content).toContain("motion-reduce:opacity-100");
    expect(content).toContain("motion-reduce:!animate-none");
    expect(content).toContain("motion-reduce:!transform-none");
  });

  it("StudentHeader uses shared BrandWordmark with priority and identical sizing", () => {
    expect(fs.existsSync(studentHeaderPath)).toBe(true);
    const content = fs.readFileSync(studentHeaderPath, "utf-8");

    // Must import and use BrandWordmark
    expect(content).toContain('import { BrandWordmark } from "@/components/ui/brand-wordmark"');
    expect(content).toContain("<BrandWordmark");

    // Header MUST retain priority for LCP
    expect(content).toMatch(/<BrandWordmark[^>]*priority/);

    // Must preserve exact header sizes
    expect(content).toContain("h-5 xs:h-6 sm:h-7 w-auto object-contain");
  });

  it("guarantees untouched boundary: Healthy transition is not modified", () => {
    expect(fs.existsSync(healthyTransitionPath)).toBe(true);
    const content = fs.readFileSync(healthyTransitionPath, "utf-8");

    // Must remain dedicated healthy mode transition
    expect(content).toContain("HealthyLogoTransition");
    expect(content).toContain("Entering Healthy Mode");
    expect(content).toContain("healthymode-logo-transition.mp4");
  });
});
