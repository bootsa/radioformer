/** Title transformers: turn the raw ICY `StreamTitle` text into what the radio should show. */

export type TitleTransformer = (raw: string) => string;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>(.*?)</${name}>`, 's').exec(xml);
  return m?.[1] ? unescapeXml(m[1]).trim() : '';
}

/**
 * Stations running Dalet automation send titles as XML, for example
 * `<RadioInfo><Table><DB_DALET_ARTIST_NAME>..</DB_DALET_ARTIST_NAME>..`.
 * Returns "Artist - Title", falls back to "Programme - Title" or just the title; copes with truncated XML.
 */
export function daletXml(raw: string): string {
  const s = raw.trim();
  if (!s.includes('<RadioInfo') && !s.startsWith('<?xml')) return s;
  const artist = tag(s, 'DB_DALET_ARTIST_NAME') || tag(s, 'DB_LEAD_ARTIST_NAME');
  const title = tag(s, 'DB_DALET_TITLE_NAME');
  const show = s.includes('<AnimadorInfo>') ? tag(s, 'TITLE') : '';
  if (artist && title) return `${artist} - ${title}`;
  if (title && show && title !== show) return `${show} - ${title}`;
  return title || show || artist || '';
}

export const transformers: Readonly<Record<string, TitleTransformer>> = {
  none: (s) => s,
  'dalet-xml': daletXml,
};

export function getTransformer(id: string): TitleTransformer {
  return transformers[id] ?? transformers['none']!;
}
