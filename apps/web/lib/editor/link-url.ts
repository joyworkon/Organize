/** Navigation-only validation. Never fetches URLs or changes the Link mark schema. */
export function normalizeLinkUrl(input: string): string | null {
  const value = input.trim();
  if (!value || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return null;
  // Keep application routes and block anchors; reject protocol-relative destinations.
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("#") && value.length > 1) return value;
  if (/^mailto:[^@:?]+@[^@:?]+\.[^@:?]+(?:\?.*)?$/i.test(value)) return value;
  if (/^tel:\+?[\d().-]+$/i.test(value)) return value;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\//i.test(value) && !/^[^/:?#]+\.[^/:?#]+(?::\d+)?(?:[/?#]|$)/u.test(value)) return null;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    // URL's parser accepts malformed schemes as hostnames (e.g. https://javascript:...).
    if (!url.hostname.includes(".") && url.hostname !== "localhost" && !url.hostname.startsWith("[")) return null;
    if (!url.hostname.startsWith("[") && !url.hostname.replace(/\.$/, "").split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Only same-origin routes are application navigation, even if an external URL contains /notes/. */
export function applicationLinkPath(href: string, baseUrl: string): string | null {
  const safe = normalizeLinkUrl(href);
  if (!safe) return null;
  try {
    const base = new URL(baseUrl);
    const url = new URL(safe, base);
    return url.origin === base.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
