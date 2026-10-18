import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Token Security: pickup_token Protection & orders Query Invariants", () => {
  const srcDir = path.resolve(__dirname, "../..");

  function getAllSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules or build directories if any
        if (entry.name !== "node_modules" && entry.name !== ".next") {
          files = files.concat(getAllSourceFiles(fullPath));
        }
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.includes(".test.") &&
        !entry.name.includes(".spec.")
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it("ensures NO source file in src/ ever selects orders.pickup_token", () => {
    const files = getAllSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; line: number; match: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((lineText, idx) => {
        // Look for occurrences of pickup_token in queries or code (excluding comment-only lines)
        if (lineText.includes("pickup_token")) {
          const trimmed = lineText.trim();
          if (!trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) {
            violations.push({
              file: path.relative(srcDir, file),
              line: idx + 1,
              match: trimmed,
            });
          }
        }
      });
    }

    expect(
      violations,
      `Found forbidden references to pickup_token in source files: ${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });

  it("ensures NO query on orders in src/ uses select('*') or select() with wildcard", () => {
    const files = getAllSourceFiles(srcDir);
    const violations: { file: string; line: number; match: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");

      // Check if file accesses orders table
      if (content.includes('.from("orders")') || content.includes(".from('orders')")) {
        const lines = content.split("\n");
        lines.forEach((lineText, idx) => {
          // Check for select("*"), select('*'), select(`*`) or unprojected .select()
          if (
            /\.select\(\s*['"`]\*['"`]\s*\)/.test(lineText) ||
            /\.select\(\s*\)/.test(lineText)
          ) {
            violations.push({
              file: path.relative(srcDir, file),
              line: idx + 1,
              match: lineText.trim(),
            });
          }
        });
      }
    }

    expect(
      violations,
      `Found wildcard select('*') on orders in source files: ${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });

  it("verifies migration 0016_protect_pickup_token.sql properly revokes and grants", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../supabase/migrations/0016_protect_pickup_token.sql"
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const content = fs.readFileSync(migrationPath, "utf-8");

    // Must revoke from authenticated and anon
    expect(content).toContain("REVOKE SELECT ON TABLE public.orders FROM authenticated, anon;");

    // Must dynamically exclude pickup_token
    expect(content).toContain("column_name != 'pickup_token'");

    // Must reload schema
    expect(content).toContain("NOTIFY pgrst, 'reload schema';");

    // Must NOT contain BEGIN or COMMIT
    expect(content).not.toMatch(/^BEGIN;/m);
    expect(content).not.toMatch(/^COMMIT;/m);
  });
});
