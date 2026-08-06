import { describe, expect, it } from "vitest";
import { prepareReadingContent } from "./reading-images";

describe("prepareReadingContent", () => {
  it("adds safe loading attributes to stored images", () => {
    const content = prepareReadingContent('<p>正文</p><img src="https://cdn.example/a.jpg">');

    expect(content).toContain('referrerpolicy="no-referrer"');
    expect(content).toContain('decoding="async"');
    expect(content).toContain('loading="lazy"');
  });

  it("replaces an old referrer policy and preserves explicit loading", () => {
    const content = prepareReadingContent(
      '<img src="https://cdn.example/a.jpg" referrerpolicy="origin" loading="eager">'
    );

    expect(content).toContain('referrerpolicy="no-referrer"');
    expect(content).not.toContain('referrerpolicy="origin"');
    expect(content.match(/referrerpolicy=/g)).toHaveLength(1);
    expect(content).toContain('loading="eager"');
  });
});
