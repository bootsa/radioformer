import type { Station } from './station.ts';

/** Read access to the station library, as needed by the radio protocols. */
export interface LibraryReader {
  /** All stations, optionally limited to one collection, sorted by name. */
  listStations(collection?: string): Station[];
  getStation(id: number): Station | null;
  /** Names of collections that contain at least one station. */
  listCollections(): string[];
}
