import { describe, expect, it } from "vitest";
import { sanitizeContent } from "./sanitize-html";

describe("sanitizeContent", () => {
  it("forces remote images to load without leaking the reader Referer", () => {
    const content = sanitizeContent(
      '<img src="https://cdn.example/a.jpg" referrerpolicy="origin" onerror="alert(1)">'
    );

    expect(content).toContain('src="https://cdn.example/a.jpg"');
    expect(content).toContain('referrerpolicy="no-referrer"');
    expect(content).toContain('decoding="async"');
    expect(content).toContain('loading="lazy"');
    expect(content).not.toContain("onerror");
  });

  it("keeps inline data images while removing scripts", () => {
    const content = sanitizeContent(
      '<script>alert(1)</script><img src="data:image/png;base64,abc">'
    );

    expect(content).not.toContain("<script");
    expect(content).toContain('src="data:image/png;base64,abc"');
  });
});
