// Excerpt from Kinetica (packages/director/src/importer.ts). Shown for illustration only.
// The full source code is available at https://store.mikodes.com/p/kinetica/
//
// Guard for "make a video from a website address". The server will fetch a page the user
// names, so it first refuses anything that is not on the public internet: private and
// loopback ranges, IPv4 hidden inside IPv6, local-looking names, odd ports and credentials in the URL.

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  // … more ranges …
] as [string, number][]) blocked.addSubnet(net, bits, 'ipv4');

/** IPv4 address embedded in an IPv6 one (IPv4-mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96), or null. */
function embeddedV4(ip: string): string | null {
  const low = ip.toLowerCase();
  const dotted = low.match(/^(?:::ffff:(?:0:)?|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1]!;
  const hex = low.match(/^(?:::ffff:(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const a = parseInt(hex[1]!, 16), b = parseInt(hex[2]!, 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}

/** True when an address must never be fetched from the server. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return blocked.check(v4, 'ipv4');
    if (/^(::ffff:|64:ff9b:)/i.test(ip)) return true;   // other mapped forms: refuse rather than guess
    return blocked.check(ip, 'ipv6');
  }
  return true;
}


const PORTS = new Set(['', '80', '443', '8080', '8443']);

/** Parse and check a URL the user typed (adds https:// when the scheme is missing). */
export function checkUrl(raw: string): URL {
  let s = String(raw ?? '').trim();
  if (!s) throw new FetchRefused('Enter the address of a web page.', 'url');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { throw new FetchRefused('That is not a web address. Use one like https://example.com/page.', 'url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchRefused('Only http and https pages can be imported.', 'url');
  if (u.username || u.password) throw new FetchRefused('Addresses with a user name or password cannot be imported.', 'url');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !isIP(host)))
    throw new FetchRefused('That address is not on the public internet.', 'address');
  if (isIP(host) && isPrivateAddress(host)) throw new FetchRefused('That address is not on the public internet.', 'address');
  if (!PORTS.has(u.port)) throw new FetchRefused('Only pages on the usual web ports (80, 443, 8080, 8443) can be imported.', 'url');
  u.hash = '';
  return u;
