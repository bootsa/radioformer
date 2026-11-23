/** One track as announced by a broadcaster's "now playing" feed. */
export interface NowPlayingTrack {
  title: string;
  artist: string;
  album: string;
  year: number | null;
  label: string;
  /** Cover image address, empty when unknown. */
  cover: string;
  /** Unix seconds. */
  start: number;
  end: number;
}

export interface NowPlaying {
  /** What the radio should display: "Artist - Title", or the programme name between tracks. */
  title: string;
  track: NowPlayingTrack | null;
  programme: { title: string; start: number; end: number } | null;
  previous: NowPlayingTrack[];
  next: NowPlayingTrack | null;
  /** Unix seconds when we fetched it. */
  fetchedAt: number;
}
