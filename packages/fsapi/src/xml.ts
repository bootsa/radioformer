/** Minimal parsing of the Frontier Silicon API's XML answers (only the shapes the radios really send). */

export type FsValue = number | string;

export interface FsResponse {
  status: string;
  value?: FsValue;
  items?: FsItem[];
  listEnd?: boolean;
  sessionId?: string;
  notifies?: { node: string; value: FsValue | undefined }[];
}

export interface FsItem {
  key: number;
  fields: Record<string, FsValue>;
}

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Parses `<u8>3</u8>`, `<s16>-7</s16>`, `<c8_array>text</c8_array>` and friends. */
export function parseTypedValue(inner: string): FsValue | undefined {
  const m = /<(u8|u16|u32|s8|s16|s32|e8|c8_array)>([\s\S]*?)<\/\1>/.exec(inner);
  if (!m) return undefined;
  return m[1] === 'c8_array' ? unescapeXml(m[2]!) : Number(m[2]);
}

function parseItems(xml: string): FsItem[] {
  const items: FsItem[] = [];
  for (const m of xml.matchAll(/<item key="(\d+)">([\s\S]*?)<\/item>/g)) {
    const fields: Record<string, FsValue> = {};
    for (const f of m[2]!.matchAll(/<field name="([A-Za-z0-9_]+)">([\s\S]*?)<\/field>/g)) {
      const v = parseTypedValue(f[2]!);
      if (v !== undefined) fields[f[1]!] = v;
    }
    items.push({ key: Number(m[1]), fields });
  }
  return items;
}

export function parseResponse(xml: string): FsResponse {
  const res: FsResponse = { status: /<status>([A-Z_]+)<\/status>/.exec(xml)?.[1] ?? 'FS_PACKET_BAD' };
  const value = /<value>([\s\S]*?)<\/value>/.exec(xml);
  if (value && !xml.includes('<item ') && !xml.includes('<notify ')) {
    const v = parseTypedValue(value[1]!);
    if (v !== undefined) res.value = v;
  }
  const sid = /<sessionId>(\d+)<\/sessionId>/.exec(xml)?.[1];
  if (sid) res.sessionId = sid;
  if (xml.includes('<item ')) res.items = parseItems(xml);
  if (xml.includes('<listend')) res.listEnd = true;
  const notifies = [...xml.matchAll(/<notify node="([^"]+)">([\s\S]*?)<\/notify>/g)].map((n) => ({
    node: n[1]!,
    value: /<value>([\s\S]*?)<\/value>/.exec(n[2]!)?.[1] ? parseTypedValue(/<value>([\s\S]*?)<\/value>/.exec(n[2]!)![1]!) : undefined,
  }));
  if (notifies.length) res.notifies = notifies;
  return res;
}

/** `GET_MULTIPLE` answers: one `fsapiResponse` per node, plus a quirky leading entry without a node. */
export function parseMultiple(xml: string): Map<string, FsResponse> {
  const out = new Map<string, FsResponse>();
  for (const m of xml.matchAll(/<fsapiResponse>([\s\S]*?)<\/fsapiResponse>/g)) {
    const node = /<node>([^<]+)<\/node>/.exec(m[1]!)?.[1];
    if (node) out.set(node, parseResponse(m[1]!));
  }
  return out;
}
