import type { LibraryReader, Station } from '@radioformer/core';
import { renderList, xmlText, type Item } from './xml.ts';

export { renderList, xmlText } from './xml.ts';

export interface XmlContext {
  library: LibraryReader;
  /** Absolute URL for a path on this server, as the radio reaches it (`http://host:port/...`). */
  url(path: string): string;
  /** Where the radio should fetch the audio of a station (direct upstream or our proxy). */
  streamUrl(station: Station): string;
  /** Logo URL for a station, or empty. */
  logoUrl(station: Station): string;
  /** Called with the radio's `mac` on every request that carries one. */
  radioSeen?(mac: string): void;
}

export interface XmlResponse {
  status: number;
  contentType: string;
  body: string;
}

/** The radios stop working with lists longer than this, so longer lists are paged. */
export const MAX_ITEMS = 200;
const TOKEN = '<EncryptedToken>3a3f5ac48a1dab4e</EncryptedToken>';
const LOGIN_PATH = /^\/setupapp\/[A-Za-z0-9_-]+\/asp\/BrowseXML\/loginXML\.asp/;

const ok = (body: string): XmlResponse => ({ status: 200, contentType: 'text/plain;charset=UTF-8', body });

function stationItem(ctx: XmlContext, s: Station, detail: boolean): Item {
  const base: Item = { ItemType: 'Station', StationId: s.directoryId || s.id, StationName: xmlText(s.name) };
  if (!detail) return base;
  return {
    ...base,
    StationUrl: xmlText(ctx.streamUrl(s), 2000),
    StationDesc: xmlText(s.description),
    Logo: xmlText(ctx.logoUrl(s), 2000),
    StationFormat: 'Radio',
    StationLocation: 'Earth',
    StationBandWidth: 32,
    StationMime: 'MP3',
    Relia: 5,
  };
}

const dir = (ctx: XmlContext, title: string, path: string): Item => ({
  ItemType: 'Dir',
  Title: xmlText(title),
  UrlDir: xmlText(ctx.url(path), 2000),
  UrlDirBackUp: xmlText(ctx.url(path), 2000),
});

const previous = (ctx: XmlContext, path: string): Item => ({
  ItemType: 'Previous',
  UrlPrevious: xmlText(ctx.url(path), 2000),
  UrlPreviousBackUp: xmlText(ctx.url(path), 2000),
});

function paged(items: Item[], q: URLSearchParams): { shown: Item[]; total: number } {
  const start = Math.max(1, Number(q.get('startItems')) || 1);
  const end = Math.min(Number(q.get('endItems')) || start + MAX_ITEMS - 1, start + MAX_ITEMS - 1);
  return { shown: items.slice(start - 1, end), total: items.length };
}

/**
 * Handles the requests of older Frontier Silicon radios (XML API). Returns null for paths that are not part
 * of that protocol, so the caller can fall through to other routes.
 */
export function handleXml(path: string, query: URLSearchParams, ctx: XmlContext): XmlResponse | null {
  const mac = query.get('mac');
  if (mac) ctx.radioSeen?.(mac);

  // The radio logs in first, without a mac, and expects a fixed token back.
  if (LOGIN_PATH.test(path) && !mac) return ok(TOKEN);

  const searchType = query.get('sSearchtype');
  const search = query.get('Search');
  if ((searchType === '3' || searchType === '5') && search) {
    const id = /^\d{1,9}$/.test(search) ? Number(search) : NaN;
    // long ids are those of the original directory; short ones are our own
    const station = /^\d{10,19}$/.test(search) ? ctx.library.getStationByDirectoryId(search) : Number.isFinite(id) ? ctx.library.getStation(id) : null;
    if (!station) return ok(renderList([previous(ctx, '/?go=initial'), dir(ctx, 'No item found for this ID!', '/?go=initial')]));
    const items: Item[] = [];
    if (station.collection) items.push(previous(ctx, `/list?tid=1&cat=${encodeURIComponent(station.collection)}`));
    else items.push(previous(ctx, '/list?tid=1'));
    items.push(stationItem(ctx, station, true));
    return ok(renderList(items));
  }

  if (path === '/list') {
    const cat = query.get('cat');
    const stations = ctx.library.listStations(cat ?? undefined);
    const items: Item[] = [];
    items.push(previous(ctx, cat ? '/list?tid=1' : '/?go=initial'));
    if (!cat) for (const c of ctx.library.listCollections()) items.push(dir(ctx, c, `/list?tid=1&cat=${encodeURIComponent(c)}`));
    const rest = (cat ? stations : stations.filter((s) => !s.collection)).map((s) => stationItem(ctx, s, false));
    const { shown, total } = paged([...items.slice(1), ...rest], query);
    return ok(renderList([items[0]!, ...shown], total));
  }

  // Root menu, shown for the first request after login and whenever nothing else matches.
  const rootPath = path === '' || path === '/' || path === '/index';
  if (LOGIN_PATH.test(path) || (rootPath && (mac || query.get('go') === 'initial'))) {
    return ok(renderList([dir(ctx, 'Radio stations', '/list?tid=1')]));
  }
  return null;
}
