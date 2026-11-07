import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Sub-Step 3B: Static check for explicit column selection (no select('*'))", () => {
  function findTsFiles(dir: string): string[] {
    let results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name !== "node_modules" &&
          entry.name !== ".next" &&
          entry.name !== "__tests__" &&
          entry.name !== "tests"
        ) {
          results = results.concat(findTsFiles(full));
        }
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.includes(".test.") &&
        !entry.name.includes(".spec.")
      ) {
        results.push(full);
      }
    }
    return results;
  }

  it("ensures no main student, staff, or admin routes/actions use select('*') or unprojected select()", () => {
    const checkDirs = [
      path.resolve(process.cwd(), "src/app/(student)"),
      path.resolve(process.cwd(), "src/app/staff"),
      path.resolve(process.cwd(), "src/app/admin"),
      path.resolve(process.cwd(), "src/server/actions"),
    ];

    const violations: { file: string; line: number; match: string }[] = [];

    for (const targetDir of checkDirs) {
      if (!fs.existsSync(targetDir)) continue;
      const files = findTsFiles(targetDir);

      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        lines.forEach((lineText, idx) => {
          // Check for select('*') or select("*") or empty select() without projection
          const trimmed = lineText.trim();
          if (
            /\.select\(\s*['"]\*['"]\s*\)/.test(trimmed) ||
            /\.select\(\s*\)/.test(trimmed)
          ) {
            // Exclude head: true count-only queries like .select("id", { count: "exact", head: true })
            violations.push({
              file: path.relative(process.cwd(), file),
              line: idx + 1,
              match: trimmed,
            });
          }
        });
      }
    }

    expect(
      violations,
      `Found forbidden wildcard or unprojected select calls: ${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });
});

