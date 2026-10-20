import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("ItemDetailSheet 375px Layout & Structure Tests (Amendment 4)", () => {
  const sheetFilePath = path.resolve(
    __dirname,
    "../../components/student/item-detail-sheet.tsx"
  );
  const fileContent = fs.readFileSync(sheetFilePath, "utf-8");

  it("ensures the left text column has min-w-0 and flex-1 to prevent pushing the right block off-screen", () => {
    // Both min-w-0 and flex-1 are required on the flex child so flex items shrink below content size
    expect(fileContent).toContain('min-w-0 flex-1');
  });

  it("ensures the dish name has break-words to wrap long titles cleanly without overflow", () => {
    expect(fileContent).toContain('id="item-detail-title" className="text-xl font-bold tracking-tight break-words"');
  });

  it("ensures the right-hand block stacks price and calories pill in a column aligned to the right (flex flex-col items-end gap-1)", () => {
    expect(fileContent).toContain('className="text-right shrink-0 flex flex-col items-end gap-1"');
  });

  it("renders the calories pill under the price with exact formatting and accessible label", () => {
    expect(fileContent).toContain('~{item.calories_kcal} kcal');
    expect(fileContent).toContain('aria-label={`About ${item.calories_kcal} calories per serving`}');
  });

  it("conditionally renders the calories pill only when calories_kcal != null", () => {
    expect(fileContent).toContain('item.calories_kcal != null &&');
  });

  it("provides ingredients disclosure with accessible attributes and chevron flip", () => {
    expect(fileContent).toContain('aria-expanded={isIngredientsOpen}');
    expect(fileContent).toContain('aria-controls="ingredients-panel"');
    expect(fileContent).toContain('motion-reduce:transition-none');
    expect(fileContent).toContain('Calorie and ingredient details are provided by the canteen and are approximate.');
  });
});
