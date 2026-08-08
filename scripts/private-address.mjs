/**
 * Private / internal IP address classification.
 *
 * Shared verbatim by the Next.js server (src/lib/safe-fetch.ts) and the
 * sandboxed SDK worker (scripts/anime-resolver-worker.mjs). Plain JS with no
 * dependencies precisely so both sides import the same implementation — two
 * copies of this logic would drift, and a drift here is a hole.
 */

import { isIP } from "node:net";

/** Hostnames that never legitimately serve provider media. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 || // "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // RFC6598 CGNAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

/** Expand any IPv6 spelling to its 16 bytes, or null if unparseable. */
function ipv6Bytes(address) {
  let value = address.toLowerCase().split("%")[0];

  // A trailing dotted quad (::ffff:169.254.169.254) becomes two hex groups.
  const tail = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const quad = tail[1].split(".").map(Number);
    if (quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hex = `${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`;
    value = value.slice(0, -tail[1].length) + hex;
  }

  const [head, rest, extra] = value.split("::");
  if (extra !== undefined) return null;
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups =
    rest === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(groups[i] || "0", 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

/**
 * Textual prefix matching is not enough here: `http://[::ffff:169.254.169.254]`
 * is normalized by `new URL()` to `[::ffff:a9fe:a9fe]`, which starts with none
 * of the blocked prefixes. So compare bytes, and unwrap every IPv6 form that
 * embeds an IPv4 address (v4-mapped, v4-compatible, 6to4, NAT64) back to v4.
 */
function isPrivateIPv6(address) {
  const b = ipv6Bytes(address);
  if (!b) return true;

  const v4 = (offset) => `${b[offset]}.${b[offset + 1]}.${b[offset + 2]}.${b[offset + 3]}`;
  const zeros = (end) => b.slice(0, end).every((byte) => byte === 0);

  if (zeros(15) && b[15] === 1) return true; // ::1 loopback
  if (zeros(16)) return true; // :: unspecified
  if (zeros(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(v4(12)); // ::ffff:0:0/96
  if (zeros(12)) return isPrivateIPv4(v4(12)); // ::/96 v4-compatible
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(v4(2)); // 2002::/16 6to4
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isPrivateIPv4(v4(12)); // 64:ff9b::/96 NAT64
  }

  if (b[0] === 0xff) return true; // ff00::/8 multicast
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  return false;
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

/**
 * Scheme + hostname screen that needs no DNS.
 * Returns a reason string when the URL must be refused, or null when allowed.
 */
export function screenUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "unparseable URL";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "non-HTTP protocol";

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return "internal hostname";
  }
  if (isIP(host) && isPrivateAddress(host)) return "private address literal";
  return null;
}
