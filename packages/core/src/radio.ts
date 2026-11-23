/** Types shared by the server API and the web app. Pure data, no dependencies. */

export const PLAY_STATES = ['idle', 'buffering', 'playing', 'paused', 'rebuffering', 'error', 'stopped', 'error'] as const;
export type PlayState = (typeof PLAY_STATES)[number];

/** What the current source can do (decoded from `netRemote.play.caps`). */
export interface PlayCaps {
  pause: boolean;
  stop: boolean;
  next: boolean;
  previous: boolean;
  fastForward: boolean;
  rewind: boolean;
  shuffle: boolean;
  repeat: boolean;
  seek: boolean;
  addPreset: boolean;
}

export interface Mode {
  key: number;
  id: string;
  label: string;
  selectable: boolean;
}

export interface RadioStatus {
  name: string;
  version: string;
  /** Wi-Fi signal, 0 to 100. */
  signal: number | null;
  power: boolean;
  volume: number;
  volumeSteps: number;
  muted: boolean;
  mode: Mode | null;
  play: {
    state: PlayState;
    caps: PlayCaps;
    name: string;
    text: string;
    artist: string;
    album: string;
    graphicUri: string;
    position: number | null;
    duration: number | null;
    shuffle: boolean;
    repeat: number;
  };
  sleepSeconds: number;
  eq: { preset: number; loudness: boolean; bass: number; treble: number };
}

export interface NavItem {
  key: number;
  name: string;
  kind: 'folder' | 'item' | 'loading';
  type: number;
}

export interface Preset {
  key: number;
  name: string;
}

export interface EqPreset {
  key: number;
  label: string;
}

export type Transport = 'stop' | 'play' | 'pause' | 'next' | 'previous';

/** A radio as listed by the API. */
export interface RadioInfo {
  id: number;
  mac: string;
  label: string;
  firstSeen: string;
  lastSeen: string;
  lastIp: string;
  host: string;
}
