import type { DatabaseSync } from 'node:sqlite';
import { Station, type LibraryReader } from '@radioformer/core';

interface Row {
  id: number;
  name: string;
  stream_url: string;
  logo_id: number | null;
  description: string;
  country: string;
  language: string;
  tags: string;
  transformer: string;
  proxy_mode: string;
  collection: string;
  metadata_source: string;
}

const toStation = (r: Row): Station =>
  Station.parse({
    id: r.id,
    name: r.name,
    streamUrl: r.stream_url,
    logoId: r.logo_id,
    description: r.description,
    country: r.country,
    language: r.language,
    tags: JSON.parse(r.tags) as string[],
    transformer: r.transformer,
    proxyMode: r.proxy_mode,
    collection: r.collection,
    metadataSource: r.metadata_source,
  });

export type NewStation = Omit<Station, 'id'>;
export const NewStation = Station.omit({ id: true });

export interface RadioRow {
  id: number;
  mac: string;
  label: string;
  firstSeen: string;
  lastSeen: string;
  lastIp: string;
  /** Address of the radio's control interface (empty until set). */
  host: string;
}

export interface RadioSettings {
  host: string;
  pin: string;
}

export interface LogoRow {
  id: number;
  data: Buffer;
}

/** The station library and the list of radios, stored in SQLite. */
export class SqliteLibrary implements LibraryReader {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  listStations(collection?: string): Station[] {
    const rows = (
      collection === undefined
        ? this.#db.prepare('SELECT * FROM station ORDER BY name COLLATE NOCASE')
        : this.#db.prepare('SELECT * FROM station WHERE collection = ? ORDER BY name COLLATE NOCASE')
    ).all(...(collection === undefined ? [] : [collection])) as unknown as Row[];
    return rows.map(toStation);
  }

  getStation(id: number): Station | null {
    const row = this.#db.prepare('SELECT * FROM station WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? toStation(row) : null;
  }

  listCollections(): string[] {
    const rows = this.#db
      .prepare("SELECT DISTINCT collection FROM station WHERE collection <> '' ORDER BY collection COLLATE NOCASE")
      .all() as unknown as { collection: string }[];
    return rows.map((r) => r.collection);
  }

  createStation(s: NewStation): Station {
    const res = this.#db
      .prepare(
        `INSERT INTO station (name, stream_url, logo_id, description, country, language, tags, transformer, proxy_mode, collection, metadata_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.name, s.streamUrl, s.logoId, s.description, s.country, s.language, JSON.stringify(s.tags), s.transformer, s.proxyMode, s.collection, s.metadataSource);
    return this.getStation(Number(res.lastInsertRowid))!;
  }

  updateStation(id: number, s: NewStation): Station | null {
    const res = this.#db
      .prepare(
        `UPDATE station SET name=?, stream_url=?, logo_id=?, description=?, country=?, language=?, tags=?, transformer=?, proxy_mode=?, collection=?, metadata_source=? WHERE id=?`,
      )
      .run(s.name, s.streamUrl, s.logoId, s.description, s.country, s.language, JSON.stringify(s.tags), s.transformer, s.proxyMode, s.collection, s.metadataSource, id);
    return res.changes > 0 ? this.getStation(id) : null;
  }

  deleteStation(id: number): boolean {
    return this.#db.prepare('DELETE FROM station WHERE id = ?').run(id).changes > 0;
  }

  /** Stores a logo (deduplicated by hash) and returns its id. */
  saveLogo(sha256: string, width: number, height: number, data: Buffer, origin: string): number {
    const existing = this.#db.prepare('SELECT id FROM logo WHERE sha256 = ?').get(sha256) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(this.#db.prepare('INSERT INTO logo (sha256, width, height, data, origin) VALUES (?, ?, ?, ?, ?)').run(sha256, width, height, data, origin).lastInsertRowid);
  }

  getLogo(id: number): Buffer | null {
    const row = this.#db.prepare('SELECT data FROM logo WHERE id = ?').get(id) as { data: Uint8Array } | undefined;
    return row ? Buffer.from(row.data) : null;
  }

  setStationLogo(stationId: number, logoId: number | null): boolean {
    return this.#db.prepare('UPDATE station SET logo_id = ? WHERE id = ?').run(logoId, stationId).changes > 0;
  }

  /** Records a sighting of a radio; creates the row on first contact. */
  touchRadio(mac: string, ip: string): void {
    this.#db
      .prepare(
        `INSERT INTO radio (mac, last_ip) VALUES (?, ?)
         ON CONFLICT(mac) DO UPDATE SET last_seen = datetime('now'), last_ip = excluded.last_ip`,
      )
      .run(mac, ip);
  }

  listRadios(): RadioRow[] {
    const rows = this.#db.prepare('SELECT * FROM radio ORDER BY last_seen DESC').all() as unknown as {
      id: number; mac: string; label: string; first_seen: string; last_seen: string; last_ip: string; host: string;
    }[];
    return rows.map((r) => ({ id: r.id, mac: r.mac, label: r.label, firstSeen: r.first_seen, lastSeen: r.last_seen, lastIp: r.last_ip, host: r.host }));
  }

  getRadio(id: number): (RadioRow & { pin: string }) | null {
    const r = this.#db.prepare('SELECT * FROM radio WHERE id = ?').get(id) as unknown as
      | { id: number; mac: string; label: string; first_seen: string; last_seen: string; last_ip: string; host: string; pin: string }
      | undefined;
    return r ? { id: r.id, mac: r.mac, label: r.label, firstSeen: r.first_seen, lastSeen: r.last_seen, lastIp: r.last_ip, host: r.host, pin: r.pin } : null;
  }

  updateRadio(id: number, label: string, settings: RadioSettings): boolean {
    return this.#db.prepare('UPDATE radio SET label = ?, host = ?, pin = ? WHERE id = ?').run(label, settings.host, settings.pin, id).changes > 0;
  }
}
