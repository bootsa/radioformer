import type { NowPlaying, NowPlayingTrack } from '@radioformer/core';

interface Step {
  title?: string;
  start: number;
  end: number;
  embedType?: string;
  depth?: number;
  titleConcept?: string | null;
  authors?: string | null;
  performers?: string | null;
  titreAlbum?: string | null;
  album?: string | null;
  anneeEditionMusique?: number | null;
  label?: string | null;
  visual?: string | null;
}

export const trim = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function toTrack(s: Step): NowPlayingTrack {
  const visual = trim(s.visual);
  return {
    title: trim(s.title),
    artist: trim(s.authors) || trim(s.performers),
    album: trim(s.titreAlbum) || trim(s.album),
    year: typeof s.anneeEditionMusique === 'number' ? s.anneeEditionMusique : null,
    label: trim(s.label),
    cover: /^https:\/\//.test(visual) ? visual : '',
    start: s.start,
    end: s.end,
  };
}

/**
 * Turns an answer of `https://api.radiofrance.fr/livemeta/pull/<station>` (the feed behind radiofrance.fr's
 * "titres diffusés" pages) into what a radio should show right now.
 */
export function parseLivemeta(data: unknown, nowSec: number): NowPlaying {
  const steps = Object.values(((data as { steps?: Record<string, Step> } | null)?.steps ?? {})).filter(
    (s) => typeof s?.start === 'number' && typeof s?.end === 'number',
  );
  const songs = steps.filter((s) => s.embedType === 'song').sort((a, b) => a.start - b.start);
  const current = songs.find((s) => s.start <= nowSec && nowSec < s.end) ?? null;
  const shows = steps.filter((s) => s.embedType !== 'song' && s.start <= nowSec && nowSec < s.end).sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
  const show = shows[0] ?? null;
  const track = current ? toTrack(current) : null;
  const programme = show ? { title: trim(show.titleConcept) || trim(show.title), start: show.start, end: show.end } : null;
  const title = track ? (track.artist ? `${track.artist} - ${track.title}` : track.title) : (programme?.title ?? '');
  return {
    title,
    track,
    programme,
    previous: songs.filter((s) => s.end <= nowSec).slice(-5).reverse().map(toTrack),
    next: songs.find((s) => s.start > nowSec) ? toTrack(songs.find((s) => s.start > nowSec)!) : null,
    fetchedAt: nowSec,
  };
}

export async function fetchRadioFrance(stationId: string, fetchImpl: typeof fetch = fetch): Promise<NowPlaying> {
  const res = await fetchImpl(`https://api.radiofrance.fr/livemeta/pull/${encodeURIComponent(stationId)}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json', 'User-Agent': 'radioformer/0 (+https://github.com/bootsa/radioformer)' },
  });
  if (!res.ok) throw new Error(`Radio France feed answered ${res.status}`);
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error('Radio France feed answer too large');
  return parseLivemeta(JSON.parse(text), Math.floor(Date.now() / 1000));
}
