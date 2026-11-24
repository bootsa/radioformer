/**
 * Requests for the radio's own cloud service that Radioformer does not handle itself
 * (old presets, stations from the original directory) are answered by the real service.
 * Radioformer resolves the real address itself: the DNS redirect only applies to the radio.
 */
const RADIO_HOST = /^[a-z0-9-]+\.(wifi|internet)radiofrontier\.com$/i;

export interface PassthroughResult {
  status: number;
  contentType: string;
  body: Buffer;
  location?: string;
}

export function isRadioHost(host: string | undefined): boolean {
  return !!host && RADIO_HOST.test(host.replace(/:\d+$/, ''));
}

export async function passthrough(
  host: string,
  pathAndQuery: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<PassthroughResult | null> {
  const h = host.replace(/:\d+$/, '');
  if (!RADIO_HOST.test(h) || !pathAndQuery.startsWith('/')) return null;
  try {
    const res = await fetchImpl(`http://${h}${pathAndQuery}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'FSL/1.0' },
    });
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > 2_000_000) return null;
    const out: PassthroughResult = { status: res.status, contentType: res.headers.get('content-type') ?? 'text/plain', body };
    const location = res.headers.get('location');
    if (location) out.location = location;
    return out;
  } catch {
    return null;
  }
}
