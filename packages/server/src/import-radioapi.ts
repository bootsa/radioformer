import type { NewStation } from './library.ts';

interface LegacyEntry {
  name?: unknown;
  url?: unknown;
  logo?: unknown;
  desc?: unknown;
  proxy?: unknown;
  category?: unknown;
}

export interface ImportResult {
  stations: NewStation[];
  skipped: { entry: unknown; reason: string }[];
}

/**
 * Converts entries of an old Radio-API `radios_<id>.json` file. Radio-API's own "proxy" flag means the
 * radio could not play the stream directly, so those stations are set to go through our proxy.
 */
export function convertRadioApi(entries: unknown): ImportResult {
  const result: ImportResult = { stations: [], skipped: [] };
  if (!Array.isArray(entries)) return { stations: [], skipped: [{ entry: entries, reason: 'not a list' }] };
  for (const e of entries as LegacyEntry[]) {
    if (typeof e?.name !== 'string' || typeof e.url !== 'string' || !/^https?:\/\//i.test(e.url)) {
      result.skipped.push({ entry: e, reason: 'needs a name and an http(s) url' });
      continue;
    }
    result.stations.push({
      name: e.name.slice(0, 200),
      streamUrl: e.url,
      logoId: null,
      description: typeof e.desc === 'string' ? e.desc.slice(0, 1000) : '',
      country: '',
      language: '',
      tags: [],
      transformer: 'none',
      proxyMode: e.proxy === true ? 'proxy' : 'auto',
      collection: typeof e.category === 'string' ? e.category.slice(0, 100) : '',
      metadataSource: '',
    });
  }
  return result;
}
