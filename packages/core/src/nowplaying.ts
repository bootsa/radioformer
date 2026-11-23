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

const line = (t: NowPlayingTrack | null | undefined): string => (t ? (t.artist ? `${t.artist} - ${t.title}` : t.title) : '');

/** The values a title template can use. */
export function titleFields(np: NowPlaying): Record<string, string> {
  const t = np.track;
  return {
    artist: t?.artist ?? '',
    title: t?.title ?? '',
    track: line(t),
    album: t?.album ?? '',
    year: t?.year ? String(t.year) : '',
    label: t?.label ?? '',
    programme: np.programme?.title ?? '',
    next: line(np.next),
    previous: line(np.previous[0]),
  };
}

export const DEFAULT_TITLE_TEMPLATE = '{track}';

/**
 * Fills in a title template. `{name}` is replaced by a value (see `titleFields`); a part in square brackets,
 * `[ · Next: {next}]`, is dropped completely when any value inside it is empty, so the text never contains
 * dangling separators. Without a template the broadcaster's own title is used.
 */
export function renderTitle(np: NowPlaying, template: string): string {
  if (!template.trim()) return np.title;
  const fields = titleFields(np);
  const fill = (text: string): { out: string; missing: boolean } => {
    let missing = false;
    const out = text.replace(/\{([a-z]+)\}/g, (_m, name: string) => {
      const v = fields[name] ?? '';
      if (v === '' && name in fields) missing = true;
      return v;
    });
    return { out, missing };
  };
  const withGroups = template.replace(/\[([^[\]]*)\]/g, (_m, inner: string) => {
    const r = fill(inner);
    return r.missing ? '' : r.out;
  });
  const main = fill(withGroups);
  // a missing value outside the optional parts means the format cannot be filled: show the broadcaster's title
  return main.missing ? np.title : main.out.replace(/\s+/g, ' ').trim() || np.title;
}
