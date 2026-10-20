import { describe, expect, it } from "vitest";
import { applicationLinkPath, normalizeLinkUrl } from "./link-url";

describe("link URL normalization", () => {
  it.each([
    ["example.com", "https://example.com"], ["  example.com/path?q=1#two  ", "https://example.com/path?q=1#two"],
    ["https://example.com", "https://example.com"], ["http://example.com:8080", "http://example.com:8080"],
    ["/notes/id#block", "/notes/id#block"], ["#block", "#block"], ["mailto:me@example.com", "mailto:me@example.com"], ["tel:+123-456", "tel:+123-456"],
  ])("normalizes %s", (input, expected) => expect(normalizeLinkUrl(input)).toBe(expected));
  it.each(["", "hello world", "example", "javascript:alert(1)", "data:text/html,test", "ftp://example.com", "//evil.com", "/\\evil.com", "https://", "https://user:pass@example.com", "https://example.com\n/path", "mailto:missing", "example.com:bad", "https://example..com", "https://-example.com", "https://bad_host.com"])("rejects %s", (input) => expect(normalizeLinkUrl(input)).toBeNull());
  it("routes only same-origin destinations inside the app", () => {
    expect(applicationLinkPath("/notes/a#b", "https://app.example.com")).toBe("/notes/a#b");
    expect(applicationLinkPath("https://app.example.com/notes/a?q=1", "https://app.example.com")).toBe("/notes/a?q=1");
    expect(applicationLinkPath("https://external.com/notes/a", "https://app.example.com")).toBeNull();
    expect(applicationLinkPath("#block", "https://app.example.com/notes/a?q=1")).toBe("/notes/a?q=1#block");
    expect(applicationLinkPath("javascript:alert(1)", "https://app.example.com")).toBeNull();
  });
});
