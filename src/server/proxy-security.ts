import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

/**
 * Validate a configured upstream URL immediately before making a proxy request.
 * The allowlist is an exact hostname match (case-insensitive, trailing dot
 * ignored); subdomains are not implicitly trusted.
 */
export async function assertAllowedDestination(
  input: string,
  allowedHosts: readonly string[],
): Promise<URL> {
  return (await resolveAllowedDestination(input, allowedHosts)).url;
}

async function resolveAllowedDestination(
  input: string,
  allowedHosts: readonly string[],
): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid upstream URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Upstream URLs must use HTTPS");
  }
  if (url.username || url.password || /^https:\/\/[^/?#]*@/i.test(url.href)) {
    throw new Error("Upstream URLs must not contain credentials");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Upstream URLs must use port 443");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !allowedHosts.some((host) => normalizeConfiguredHost(host) === hostname)) {
    throw new Error("Upstream hostname is not allowlisted");
  }
  if (isLocalHostname(hostname)) {
    throw new Error("Local and reserved hostnames cannot be upstream destinations");
  }

  // Reject direct IP URLs unless explicitly configured, and still subject
  // them to the same public-address checks as DNS answers.
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Upstream hostname resolves to a non-public address");
  }

  return { url, addresses };
}

/**
 * Fetch an upstream with DNS rebinding protection. Validation and resolution
 * happen for every call, and the TLS connection is pinned to one of the exact
 * public addresses returned by that resolution. TLS certificate validation
 * still uses the URL hostname. Redirect responses are rejected and never
 * followed.
 *
 * Use this helper for proxy traffic instead of calling global `fetch` after
 * `assertAllowedDestination`; a separate fetch would perform a fresh DNS
 * lookup and reintroduce a rebinding window.
 */
export async function safeFetch(
  input: string | URL,
  allowedHosts: readonly string[],
  init: RequestInit = {},
): Promise<Response> {
  const { url, addresses } = await resolveAllowedDestination(String(input), allowedHosts);
  const hostname = normalizeHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const pinned = addresses[0];
  const request = new Request(url, { ...init, redirect: "manual" });
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    // The destination authority is derived from the validated URL, never from
    // a caller-supplied Host header.
    if (name.toLowerCase() !== "host") headers[name] = value;
  });
  headers.host = url.host;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const req = httpsRequest(
      {
        hostname: pinned.address,
        family: pinned.family,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers,
        // Preserve hostname-based SNI and certificate verification while the
        // network connection itself uses the already-checked numeric address.
        ...(literalFamily ? {} : { servername: hostname }),
        signal: request.signal,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          incoming.resume();
          settled = true;
          reject(new TypeError("Redirects are not allowed for proxy requests"));
          return;
        }

        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined || name === "set-cookie") continue;
          responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        for (const cookie of incoming.headers["set-cookie"] ?? []) {
          responseHeaders.append("set-cookie", cookie);
        }

        const bodylessStatus = status === 204 || status === 205 || status === 304;
        if (bodylessStatus) incoming.resume();
        const body = bodylessStatus
          ? null
          : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        settled = true;
        resolve(new Response(body, {
          status,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }));
      },
    );

    req.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    const body = request.body;
    if (body) {
      const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
      source.once("error", (error) => req.destroy(error));
      source.pipe(req);
    } else {
      req.end();
    }
  });
}

function normalizeConfiguredHost(host: string): string {
  // Parse hostnames through URL to apply the same IDNA normalization as the
  // destination. Config entries must be bare hostnames, not URLs or paths.
  if (host.includes("/") || host.includes("@") || host.includes("://")) return "";
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.port || parsed.username || parsed.password) return "";
    return normalizeHostname(parsed.hostname);
  } catch {
    return "";
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || [
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
    ".onion",
    ".test",
    ".invalid",
    ".example",
  ].some((suffix) => hostname.endsWith(suffix));
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

function isPublicIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  // IANA special-purpose, private, loopback, link-local, documentation,
  // benchmarking, multicast, and reserved IPv4 ranges.
  const blocked = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ];
  const numericAddress = octets.reduce((value, part) => value * 256 + part, 0) >>> 0;
  return !blocked.some((range) => {
    const [networkText, prefixText] = range.split("/");
    const network = networkText.split(".").map(Number).reduce((value, part) => value * 256 + part, 0) >>> 0;
    const prefix = Number(prefixText);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (numericAddress & mask) === (network & mask);
  });
}

function isPublicIPv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  // Publicly routable unicast IPv6 currently lives in 2000::/3. This also
  // rejects unspecified, loopback, unique-local, link-local, multicast,
  // IPv4-mapped, and NAT64 addresses by default.
  if (!value.startsWith("2") && !value.startsWith("3")) return false;

  // Documentation, transition, and special-purpose blocks are not suitable
  // upstream destinations. 2001::/23 contains IETF protocol assignments.
  const words = expandIPv6(value);
  if (!words) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  if (value.startsWith("2002:")) return false;
  if (words[0] === 0x2001 && words[1] <= 0x01ff) return false;
  return true;
}

function expandIPv6(address: string): number[] | undefined {
  // The Node isIP check has already validated syntax. Expand :: into the
  // omitted zero words, including IPv4-embedded forms where Node accepts them.
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parse = (word: string) => Number.parseInt(word, 16);
  const leftWords = left.map(parse);
  const rightWords = right.map(parse);
  if (leftWords.some(Number.isNaN) || rightWords.some(Number.isNaN)) return undefined;
  const missing = 8 - leftWords.length - rightWords.length;
  if (halves.length === 1 && missing !== 0) return undefined;
  if (missing < 0) return undefined;
  return [...leftWords, ...Array(missing).fill(0), ...rightWords];
}
