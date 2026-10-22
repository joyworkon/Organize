// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentHref, attachmentName, downloadAttachment } from "./file-attachment";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("attachment names and URLs", () => {
  it("trims names and falls back for whitespace", () => {
    expect(attachmentName("  report.pdf  ")).toBe("report.pdf"); expect(attachmentName(" \n ")).toBe("附件");
  });
  it("only navigates http/https/blob, including relative storage paths", () => {
    const base = "https://example.com/notes/1";
    for (const value of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/test", null, "", "http://["]) expect(attachmentHref(value, base)).toBeUndefined();
    expect(attachmentHref("/files/a.pdf", base)).toBe("https://example.com/files/a.pdf");
    expect(attachmentHref("blob:https://example.com/123", base)).toBe("blob:https://example.com/123");
    expect(attachmentHref("http://example.com/a", base)).toBe("http://example.com/a");
  });
  it("downloads via a blob, uses the display name and releases the URL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["pdf"]) }));
    const create = vi.fn(() => "blob:download"), revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    let download = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { download = this.download; expect(this.href).toBe("blob:download"); });
    await downloadAttachment("https://example.com/a", "  新名称.pdf ");
    expect(download).toBe("新名称.pdf"); expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith("blob:download");
  });
  it("propagates errors for the toolbar fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(downloadAttachment("https://example.com/a", "a")).rejects.toThrow();
  });
});
