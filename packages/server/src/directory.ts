import { passthrough, type PassthroughResult } from './passthrough.ts';

export interface DirectoryStation {
  id: string;
  name: string;
  format: string;
  location: string;
  logo: string;
}

const text = (block: string, tag: string) =>
  (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** Stations in a list the radio's original directory sent back. */
export function parseDirectoryList(xml: string): DirectoryStation[] {
  const out: DirectoryStation[] = [];
  for (const m of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const block = m[1] ?? '';
    if (text(block, 'ItemType') !== 'Station') continue;
    const id = text(block, 'StationId');
    if (!/^\d{10,19}$/.test(id)) continue;
    out.push({ id, name: text(block, 'StationName'), format: text(block, 'StationFormat'), location: text(block, 'StationLocation'), logo: text(block, 'Logo') });
  }
  return out;
}

/** The generic device id used when we search on our own behalf, so no radio is identified to the service. */
const SEARCH_DEVICE = '0'.repeat(32);

/** Looks a station up by name in the radio's original directory (the one Airable runs). */
export async function searchDirectory(query: string, pass: typeof passthrough = passthrough): Promise<DirectoryStation[] | null> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const path = `/setupapp/Roberts/asp/BrowseXML/Search.asp?sSearchtype=2&Search=${encodeURIComponent(q)}&mac=${SEARCH_DEVICE}&dlang=eng&fver=8&ven=rob29`;
  const res: PassthroughResult | null = await pass('roberts.wifiradiofrontier.com', path);
  if (!res || res.status !== 200) return null;
  return parseDirectoryList(res.body.toString('utf8'));
}
