import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ValidatedUrl {
  url: URL;
  addresses: ResolvedAddress[];
}

export interface UrlSafetyOptions {
  /**
   * Some local outbound networks map public DNS names to RFC 2544 benchmark
   * addresses and route the request through a transparent proxy. This opt-in
   * only relaxes that synthetic range; private and link-local ranges remain
   * blocked.
   */
  allowSyntheticAddresses?: boolean;
}

export class UrlSafetyError extends Error {
  constructor(
    public readonly code: "INVALID_URL" | "URL_BLOCKED" | "DNS_FAILED",
    message: string
  ) {
    super(message);
    this.name = "UrlSafetyError";
  }
}

const BLOCKED_HOSTS = new Set([
  "instance-data.ec2.internal",
  "metadata.aws.internal",
  "metadata.azure.internal",
  "metadata.google.internal",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".lan",
  ".local",
  ".localhost",
  ".home",
];

const defaultLookup: AddressLookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results
    .filter((result): result is { address: string; family: 4 | 6 } =>
      result.family === 4 || result.family === 6
    )
    .map(({ address, family }) => ({ address, family }));
};

export async function validatePublicUrl(
  input: string | URL,
  lookup: AddressLookup = defaultLookup,
  options: UrlSafetyOptions = {}
): Promise<ValidatedUrl> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch {
    throw new UrlSafetyError("INVALID_URL", "URL 格式不正确");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlSafetyError("INVALID_URL", "仅支持 HTTP/HTTPS 链接");
  }
  if (url.username || url.password) {
    throw new UrlSafetyError("INVALID_URL", "URL 不能包含登录凭据");
  }

  const hostname = stripIpv6Brackets(url.hostname).replace(/\.$/, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UrlSafetyError("URL_BLOCKED", "该地址不允许抓取");
  }

  let addresses: ResolvedAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await lookup(hostname);
    } catch {
      throw new UrlSafetyError("DNS_FAILED", "域名解析失败");
    }
  }

  if (addresses.length === 0) {
    throw new UrlSafetyError("DNS_FAILED", "域名没有可用地址");
  }

  for (const result of addresses) {
    const actualFamily = isIP(result.address);
    const addressOptions: UrlSafetyOptions = {
      allowSyntheticAddresses:
        options.allowSyntheticAddresses && literalFamily === 0,
    };
    if (
      actualFamily !== result.family ||
      isBlockedAddress(result.address, addressOptions)
    ) {
      throw new UrlSafetyError("URL_BLOCKED", "该地址不允许抓取");
    }
  }

  return { url, addresses };
}

export function isBlockedAddress(
  address: string,
  options: UrlSafetyOptions = {}
): boolean {
  const normalized = stripIpv6Brackets(address);
  const family = isIP(normalized);
  if (family === 4) {
    const value = ipv4ToNumber(normalized);
    if (options.allowSyntheticAddresses && isSyntheticIpv4(value)) {
      return false;
    }
    return BLOCKED_IPV4_RANGES.some(([base, prefix]) =>
      inIpv4Cidr(value, base, prefix)
    );
  }
  if (family !== 6) return true;

  const bytes = parseIpv6(normalized);
  if (!bytes) return true;

  // Only globally routable unicast space is allowed.
  if ((bytes[0] & 0xe0) !== 0x20) return true;

  // IETF protocol assignments, documentation, and 6to4 transition space.
  if (inIpv6Cidr(bytes, "2001::", 23)) return true;
  if (inIpv6Cidr(bytes, "2001:db8::", 32)) return true;
  if (inIpv6Cidr(bytes, "2002::", 16)) return true;

  return false;
}

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [ipv4ToNumber("0.0.0.0"), 8],
  [ipv4ToNumber("10.0.0.0"), 8],
  [ipv4ToNumber("100.64.0.0"), 10],
  [ipv4ToNumber("127.0.0.0"), 8],
  [ipv4ToNumber("169.254.0.0"), 16],
  [ipv4ToNumber("172.16.0.0"), 12],
  [ipv4ToNumber("192.0.0.0"), 24],
  [ipv4ToNumber("192.0.2.0"), 24],
  [ipv4ToNumber("192.88.99.0"), 24],
  [ipv4ToNumber("192.168.0.0"), 16],
  [ipv4ToNumber("198.18.0.0"), 15],
  [ipv4ToNumber("198.51.100.0"), 24],
  [ipv4ToNumber("203.0.113.0"), 24],
  [ipv4ToNumber("224.0.0.0"), 4],
  [ipv4ToNumber("240.0.0.0"), 4],
];

const SYNTHETIC_IPV4_BASE = ipv4ToNumber("198.18.0.0");
const SYNTHETIC_IPV4_PREFIX = 15;

function isSyntheticIpv4(value: number): boolean {
  return inIpv4Cidr(value, SYNTHETIC_IPV4_BASE, SYNTHETIC_IPV4_PREFIX);
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function ipv4ToNumber(address: string): number {
  return address
    .split(".")
    .reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function parseIpv6(address: string): Uint8Array | null {
  if (address.includes("%")) return null;

  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (normalized.includes(".") && lastColon !== -1) {
    const ipv4 = normalized.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const value = ipv4ToNumber(ipv4);
    normalized = `${normalized.slice(0, lastColon)}:${(
      (value >>> 16) &
      0xffff
    ).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

  const parts = [...head, ...Array(missing).fill("0"), ...tail];
  if (
    parts.length !== 8 ||
    parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) {
    return null;
  }

  const bytes = new Uint8Array(16);
  parts.forEach((part, index) => {
    const value = Number.parseInt(part, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function inIpv6Cidr(bytes: Uint8Array, base: string, prefix: number): boolean {
  const baseBytes = parseIpv6(base);
  if (!baseBytes) return false;
  const fullBytes = Math.floor(prefix / 8);
  const remainingBits = prefix % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== baseBytes[index]) return false;
  }
  if (remainingBits === 0) return true;

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[fullBytes] & mask) === (baseBytes[fullBytes] & mask);
}
