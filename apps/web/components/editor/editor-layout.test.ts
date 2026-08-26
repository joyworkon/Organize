import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

describe("editor visual rhythm contract", () => {
  it("uses a fixed left-aligned marker lane for lower-roman lists", () => {
    expect(css).toContain('ol[data-list-style="lower-roman"] > li::before');
    expect(css).toContain("counter(organize-lower-roman, lower-roman)");
    expect(css).toMatch(/left:\s*-2rem;/);
    expect(css).toMatch(/text-align:\s*left;/);
  });

  it("uses a single uniform margin-bottom rhythm for all top-level blocks", () => {
    expect(css).toContain("--organize-block-gap: 0.5rem");
    // 双档间距变量已移除
    expect(css).not.toContain("--organize-block-large-gap");
    // 段落与标题同节奏：只有下间距，无上边距
    expect(css).toMatch(
      /\.organize-editor\.prose > p,\s*\.organize-editor\.prose > h1,[\s\S]*?margin-top:\s*0 !important;\s*margin-bottom:\s*var\(--organize-block-gap\) !important;/
    );
    // 不再有「上下双 margin」的块间距写法（BFC 边界不折叠会导致间距翻倍）
    expect(css).not.toMatch(/margin:\s*var\(--organize-block-gap[^)]*\)\s*0/);
  });
});
