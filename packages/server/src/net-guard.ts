import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** True for loopback, private, link-local and other addresses that must not be reached by a stream proxy. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
  }
  return true;
}

/** Resolves the host of a URL and refuses private targets unless explicitly allowed. */
export async function assertPublicUpstream(rawUrl: string, allowPrivate: boolean): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported scheme');
  if (allowPrivate) return;
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('upstream address is not public');
}

/** A radio's control address must be on the local network (private or link-local), never a public host. */
export async function assertLanHost(host: string): Promise<void> {
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new Error('not a valid host name or address');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => !isPrivateAddress(a.address))) throw new Error('the radio must be on the local network');
}
