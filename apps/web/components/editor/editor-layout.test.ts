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

  it("keeps regular blocks compact while headings retain hierarchy", () => {
    expect(css).toContain("--organize-block-gap: 0.125rem");
    expect(css).toContain("--organize-block-large-gap: 0.5rem");
    expect(css).toMatch(
      /\.organize-editor\.prose > h1\s*\{\s*margin-top:\s*1\.25rem !important;/
    );
    expect(css).toContain(".organize-editor.prose > :is(h1, h2, h3, h4) + p");
  });
});
