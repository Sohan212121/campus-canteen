import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Light and Dark Theme Toggle Feature", () => {
  const togglePath = path.resolve(__dirname, "../../components/ui/theme-toggle.tsx");
  const providerPath = path.resolve(__dirname, "../../components/theme-provider.tsx");
  const headerPath = path.resolve(__dirname, "../../components/student/student-header.tsx");
  const layoutPath = path.resolve(__dirname, "../../app/layout.tsx");

  it("exports a client ThemeToggle component with Sun and Moon icons", () => {
    expect(fs.existsSync(togglePath)).toBe(true);
    const content = fs.readFileSync(togglePath, "utf-8");

    expect(content).toContain('"use client"');
    expect(content).toContain("useTheme");
    expect(content).toContain("Sun");
    expect(content).toContain("Moon");
    expect(content).toContain('type="button"');
    expect(content).toContain("aria-label");
    expect(content).toContain("sr-only");
  });

  it("exports a ThemeProvider wrapping NextThemesProvider", () => {
    expect(fs.existsSync(providerPath)).toBe(true);
    const content = fs.readFileSync(providerPath, "utf-8");

    expect(content).toContain('"use client"');
    expect(content).toContain("NextThemesProvider");
    expect(content).toContain("ThemeProvider");
  });

  it("integrates ThemeProvider in root layout with class attribute", () => {
    expect(fs.existsSync(layoutPath)).toBe(true);
    const content = fs.readFileSync(layoutPath, "utf-8");

    expect(content).toContain("ThemeProvider");
    expect(content).toContain('attribute="class"');
    expect(content).toContain("suppressHydrationWarning");
  });

  it("places ThemeToggle, NotificationBell, and Profile button in exact sequence in StudentHeader", () => {
    expect(fs.existsSync(headerPath)).toBe(true);
    const content = fs.readFileSync(headerPath, "utf-8");

    expect(content).toContain("ThemeToggle");
    expect(content).toContain("NotificationBell");
    expect(content).toContain('aria-label="Profile"');
    expect(content).not.toContain('aria-label="Healthy Mode"');

    // Ensure order is ThemeToggle, NotificationBell, Profile (Profile at the far right)
    const toggleIndex = content.indexOf("<ThemeToggle");
    const bellIndex = content.indexOf("<NotificationBell");
    const profileIndex = content.indexOf('aria-label="Profile"');

    expect(toggleIndex).toBeGreaterThan(-1);
    expect(bellIndex).toBeGreaterThan(toggleIndex);
    expect(profileIndex).toBeGreaterThan(bellIndex);
  });
});

