import { FsapiClient, FsapiError, type FsapiOptions } from './client.ts';
import { NAV_PARENT, navFor, type NavMultiplexer, type RetryOptions } from './nav.ts';

export type { RetryOptions };
import { PLAY_STATES, type Mode, type NavItem, type PlayCaps, type RadioStatus, type Transport } from '@radioformer/core';
import type { FsItem, FsValue } from './xml.ts';

const N = {
  name: 'netRemote.sys.info.friendlyName',
  version: 'netRemote.sys.info.version',
  rssi: 'netRemote.sys.net.wlan.rssi',
  power: 'netRemote.sys.power',
  mode: 'netRemote.sys.mode',
  volume: 'netRemote.sys.audio.volume',
  volumeSteps: 'netRemote.sys.caps.volumeSteps',
  mute: 'netRemote.sys.audio.mute',
  sleep: 'netRemote.sys.sleep',
  eqPreset: 'netRemote.sys.audio.eqPreset',
  loudness: 'netRemote.sys.audio.eqLoudness',
  bass: 'netRemote.sys.audio.eqCustom.param0',
  treble: 'netRemote.sys.audio.eqCustom.param1',
  playStatus: 'netRemote.play.status',
  playCaps: 'netRemote.play.caps',
  playName: 'netRemote.play.info.name',
  playText: 'netRemote.play.info.text',
  playArtist: 'netRemote.play.info.artist',
  playAlbum: 'netRemote.play.info.album',
  playGraphic: 'netRemote.play.info.graphicUri',
  playDuration: 'netRemote.play.info.duration',
  playPosition: 'netRemote.play.position',
  shuffle: 'netRemote.play.shuffle',
  repeat: 'netRemote.play.repeat',
  control: 'netRemote.play.control',
  validModes: 'netRemote.sys.caps.validModes',
  eqPresets: 'netRemote.sys.caps.eqPresets',
  navState: 'netRemote.nav.state',
  navList: 'netRemote.nav.list',
  navigate: 'netRemote.nav.action.navigate',
  selectItem: 'netRemote.nav.action.selectItem',
  presets: 'netRemote.nav.presets',
  selectPreset: 'netRemote.nav.action.selectPreset',
} as const;

export function decodeCaps(mask: number): PlayCaps {
  const bit = (n: number) => (mask & (1 << n)) !== 0;
  return { pause: bit(0), stop: bit(1), next: bit(2), previous: bit(3), fastForward: bit(4), rewind: bit(5), shuffle: bit(6), repeat: bit(7), seek: bit(8), addPreset: bit(11) };
}

const TRANSPORT: Record<Transport, number> = { stop: 0, play: 1, pause: 2, next: 3, previous: 4 };

const num = (v: FsValue | undefined, d = 0): number => (typeof v === 'number' ? v : d);
const str = (v: FsValue | undefined): string => (typeof v === 'string' ? v : '');

/** High-level control of one radio. All calls go through one polite session (see `FsapiClient`). */
export class RadioControl {
  readonly client: FsapiClient;
  #modes: Mode[] | null = null;
  readonly #nav: NavMultiplexer;
  /** This object is one "app" as far as the radio's menu position is concerned. */
  static readonly OWNER = 'web';

  constructor(opts: FsapiOptions | FsapiClient, retry: RetryOptions = {}) {
    this.client = opts instanceof FsapiClient ? opts : new FsapiClient(opts);
    this.#nav = navFor(this.client, retry);
  }

  async modes(refresh = false): Promise<Mode[]> {
    if (!this.#modes || refresh) {
      const items = await this.client.list(N.validModes);
      this.#modes = items.map((i) => ({ key: i.key, id: str(i.fields['id']), label: str(i.fields['label']), selectable: num(i.fields['selectable']) === 1 }));
    }
    return this.#modes;
  }

  async status(): Promise<RadioStatus> {
    const v = await this.client.getMany(Object.values(N).filter((n) => !/caps\.(validModes|eqPresets)|nav\.|selectPreset|control$/.test(n)));
    const modes = await this.modes().catch(() => []);
    const modeKey = typeof v[N.mode] === 'number' ? (v[N.mode] as number) : null;
    return {
      name: str(v[N.name]),
      version: str(v[N.version]),
      signal: typeof v[N.rssi] === 'number' ? (v[N.rssi] as number) : null,
      power: num(v[N.power]) === 1,
      volume: num(v[N.volume]),
      volumeSteps: num(v[N.volumeSteps], 32),
      muted: num(v[N.mute]) === 1,
      mode: modeKey === null ? null : (modes.find((m) => m.key === modeKey) ?? { key: modeKey, id: '', label: `Mode ${modeKey}`, selectable: false }),
      play: {
        state: PLAY_STATES[num(v[N.playStatus])] ?? 'idle',
        caps: decodeCaps(num(v[N.playCaps])),
        name: str(v[N.playName]),
        text: str(v[N.playText]),
        artist: str(v[N.playArtist]),
        album: str(v[N.playAlbum]),
        graphicUri: str(v[N.playGraphic]),
        position: typeof v[N.playPosition] === 'number' ? (v[N.playPosition] as number) : null,
        duration: typeof v[N.playDuration] === 'number' && v[N.playDuration] !== 0 ? (v[N.playDuration] as number) : null,
        shuffle: num(v[N.shuffle]) === 1,
        repeat: num(v[N.repeat]),
      },
      sleepSeconds: num(v[N.sleep]),
      eq: { preset: num(v[N.eqPreset]), loudness: num(v[N.loudness]) === 1, bass: num(v[N.bass]), treble: num(v[N.treble]) },
    };
  }

  setPower(on: boolean): Promise<void> {
    return this.client.set(N.power, on ? 1 : 0);
  }
  async setVolume(level: number): Promise<void> {
    await this.client.set(N.volume, Math.max(0, Math.min(Math.round(level), 100)));
  }
  setMute(muted: boolean): Promise<void> {
    return this.client.set(N.mute, muted ? 1 : 0);
  }
  async setMode(key: number): Promise<void> {
    await this.client.set(N.mode, key);
    await this.#nav.modeChanged();
  }
  transport(cmd: Transport): Promise<void> {
    return this.client.set(N.control, TRANSPORT[cmd]);
  }
  setShuffle(on: boolean): Promise<void> {
    return this.client.set(N.shuffle, on ? 1 : 0);
  }
  setRepeat(mode: number): Promise<void> {
    return this.client.set(N.repeat, mode);
  }
  setSleep(seconds: number): Promise<void> {
    return this.client.set(N.sleep, Math.max(0, Math.round(seconds)));
  }
  async setEq(eq: { preset?: number | undefined; loudness?: boolean | undefined; bass?: number | undefined; treble?: number | undefined }): Promise<void> {
    if (eq.preset !== undefined) await this.client.set(N.eqPreset, eq.preset);
    if (eq.loudness !== undefined) await this.client.set(N.loudness, eq.loudness ? 1 : 0);
    if (eq.bass !== undefined) await this.client.set(N.bass, Math.max(-7, Math.min(7, Math.round(eq.bass))));
    if (eq.treble !== undefined) await this.client.set(N.treble, Math.max(-7, Math.min(7, Math.round(eq.treble))));
  }
  async eqPresets(): Promise<{ key: number; label: string }[]> {
    return (await this.client.list(N.eqPresets)).map((i) => ({ key: i.key, label: str(i.fields['label']) }));
  }

  /** Closes the menu browser on the radio (it returns to the root of the current mode). */
  closeNav(): Promise<void> {
    return this.#nav.disable(RadioControl.OWNER);
  }

  async presets(): Promise<{ key: number; name: string }[]> {
    await this.#nav.enable(RadioControl.OWNER);
    const items = await this.#nav.run(RadioControl.OWNER, (c) => c.list(N.presets));
    return items.filter((i) => str(i.fields['name']).trim()).map((i) => ({ key: i.key, name: str(i.fields['name']).trim() }));
  }
  async selectPreset(key: number): Promise<void> {
    await this.#nav.enable(RadioControl.OWNER);
    await this.#nav.run(RadioControl.OWNER, (c) => c.set(N.selectPreset, key));
  }

  async browse(): Promise<NavItem[]> {
    await this.#nav.enable(RadioControl.OWNER);
    return (await this.#nav.run(RadioControl.OWNER, (c) => c.list(N.navList))).map(toNavItem);
  }
  async enter(key: number): Promise<NavItem[]> {
    await this.#nav.enable(RadioControl.OWNER);
    await this.#nav.navigate(RadioControl.OWNER, key);
    return this.browse();
  }
  async back(): Promise<NavItem[]> {
    await this.#nav.enable(RadioControl.OWNER);
    await this.#nav.navigate(RadioControl.OWNER, NAV_PARENT);
    return this.browse();
  }
  async play(key: number): Promise<void> {
    await this.#nav.enable(RadioControl.OWNER);
    await this.#nav.run(RadioControl.OWNER, (c) => c.set(N.selectItem, key));
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

function toNavItem(i: FsItem): NavItem {
  const type = num(i.fields['type']);
  return { key: i.key, name: str(i.fields['name']).trim(), type, kind: type === 255 ? 'loading' : type === 0 ? 'folder' : 'item' };
}

export { FsapiError };
