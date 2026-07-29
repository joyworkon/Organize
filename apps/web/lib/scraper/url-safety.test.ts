import { describe, expect, it, vi } from "vitest";
import { safeFetchHtml, type HttpRequester } from "./safe-fetch";
import {
  isBlockedAddress,
  validatePublicUrl,
  type AddressLookup,
} from "./url-safety";

describe("SSRF address policy", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ])("blocks non-public address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows globally routable address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );

  it.each([
    "http://127.0.0.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://127.1",
    "http://[::1]",
    "http://metadata.google.internal/computeMetadata/v1",
    "http://user:pass@example.com",
  ])("rejects hostile URL %s before requesting", async (url) => {
    await expect(validatePublicUrl(url)).rejects.toMatchObject({
      code: expect.stringMatching(/INVALID_URL|URL_BLOCKED/),
    });
  });

  it("rejects a hostname when any DNS answer is private", async () => {
    const lookup: AddressLookup = async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.2", family: 4 },
    ];

    await expect(validatePublicUrl("https://example.com", lookup)).rejects.toMatchObject({
      code: "URL_BLOCKED",
    });
  });
});

describe("safeFetchHtml", () => {
  const lookup: AddressLookup = async (hostname) =>
    hostname === "public.example"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "10.0.0.9", family: 4 }];

  it("revalidates every redirect before the next request", async () => {
    const request = vi.fn<HttpRequester>(async () => ({
      status: 302,
      headers: { location: "http://private.example/secret" },
      body: "",
    }));

    await expect(
      safeFetchHtml("https://public.example", {
        timeout: 1000,
        userAgent: "test",
        lookup,
        request,
      })
    ).rejects.toMatchObject({ code: "URL_BLOCKED" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns normal public HTML through a DNS-pinned request", async () => {
    const request = vi.fn<HttpRequester>(async ({ address }) => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: `<html><head><title>${address.address}</title></head><body>ok</body></html>`,
    }));

    await expect(
      safeFetchHtml("https://public.example/article", {
        timeout: 1000,
        userAgent: "test",
        lookup,
        request,
      })
    ).resolves.toMatchObject({
      html: expect.stringContaining("93.184.216.34"),
      finalUrl: new URL("https://public.example/article"),
    });
  });

  it("rejects non-HTML and oversized responses", async () => {
    await expect(
      safeFetchHtml("https://public.example/file", {
        timeout: 1000,
        userAgent: "test",
        lookup,
        request: async () => ({
          status: 200,
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      })
    ).rejects.toMatchObject({ code: "NON_HTML" });

    await expect(
      safeFetchHtml("https://public.example/large", {
        timeout: 1000,
        userAgent: "test",
        lookup,
        maxBytes: 3,
        request: async () => ({
          status: 200,
          headers: { "content-type": "text/html" },
          body: "large",
        }),
      })
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
});
