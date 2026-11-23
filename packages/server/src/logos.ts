import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertPublicUpstream } from './net-guard.ts';

/** What the radios show: a small square picture. */
export const LOGO_SIZE = 150;
const MAX_BYTES = 2 * 1024 * 1024;

/** Converts any common image (PNG, JPEG, WebP, GIF, SVG) to a square PNG on a white background. */
export async function toRadioPng(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const data = await sharp(input, { density: 300, limitInputPixels: 40_000_000, animated: false })
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { data, width: LOGO_SIZE, height: LOGO_SIZE };
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Downloads an image with a size cap, timeouts and the same address guard as the stream proxy. */
export async function fetchImage(rawUrl: string, allowPrivate: boolean): Promise<Buffer> {
  let url = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUpstream(url, allowPrivate);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'radioformer/0', Accept: 'image/*' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`image request failed (${res.status})`);
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(type) && !/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) throw new Error('not an image');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error('image too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('too many redirects');
}

let defaultLogo: Promise<Buffer> | undefined;
/** The neutral Radioformer icon, rendered once. */
export function getDefaultLogo(): Promise<Buffer> {
  defaultLogo ??= sharp(new URL('../assets/default-logo.svg', import.meta.url).pathname, { density: 300 }).resize(LOGO_SIZE, LOGO_SIZE).png().toBuffer();
  return defaultLogo;
}
