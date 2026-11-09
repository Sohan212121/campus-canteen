import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Token Security: pickup_token Non-Reference & orders Query Invariants", () => {
  const srcDir = path.resolve(__dirname, "../..");

  function getAllSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
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

  it("ensures NO source file in src/ ever selects or references pickup_token", () => {
    const files = getAllSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; line: number; match: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((lineText, idx) => {
        if (lineText.includes("pickup_token")) {
          const trimmed = lineText.trim();
          // Exclude comment-only lines
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

  it("ensures NO query on orders in src/ uses select('*') or an unprojected select()", () => {
    const files = getAllSourceFiles(srcDir);
    const violations: { file: string; line: number; match: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");

      if (content.includes('.from("orders")') || content.includes(".from('orders')")) {
        const lines = content.split("\n");
        lines.forEach((lineText, idx) => {
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
      `Found wildcard select('*') or unprojected select() on orders in source files: ${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });

  it("ensures NO source file in src/auth or src/server/actions/auth logs auth tokens or credentials", () => {
    const authFiles = [
      path.join(srcDir, "app", "auth", "confirm", "confirm-view.tsx"),
      path.join(srcDir, "app", "auth", "confirm", "page.tsx"),
      path.join(srcDir, "server", "actions", "auth.ts"),
      path.join(srcDir, "proxy.ts"),
    ];

    const violations: { file: string; line: number; match: string }[] = [];

    for (const file of authFiles) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((lineText, idx) => {
        const trimmed = lineText.trim();
        // Check for logging of tokens
        if (
          trimmed.startsWith("console.") &&
          (trimmed.includes("token_hash") ||
            trimmed.includes("access_token") ||
            trimmed.includes("refresh_token") ||
            trimmed.includes("password") ||
            trimmed.includes("code"))
        ) {
          violations.push({
            file: path.relative(srcDir, file),
            line: idx + 1,
            match: trimmed,
          });
        }
      });
    }

    expect(
      violations,
      `Found forbidden logging of tokens/secrets in auth files: ${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });
});
