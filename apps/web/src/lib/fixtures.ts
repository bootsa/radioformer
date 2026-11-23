import type { EqPreset, Mode, NavItem, Preset, RadioStatus } from '@radioformer/core';

/** Sample data for component stories (shapes taken from a Roberts Stream 94i). */
export const sampleStatus: RadioStatus = {
	name: 'DanceHall',
	version: 'ir-mmi-FS2026-0500-0515-Stream94i_V2.14.35c',
	signal: 100,
	power: true,
	volume: 7,
	volumeSteps: 33,
	muted: false,
	mode: { key: 0, id: 'IR', label: 'Internet radio', selectable: true },
	play: {
		state: 'playing',
		caps: { pause: false, stop: true, next: false, previous: false, fastForward: false, rewind: false, shuffle: false, repeat: false, seek: false, addPreset: true },
		name: 'FIP',
		text: 'Radio France - eclectic music',
		artist: '',
		album: '',
		graphicUri: '',
		position: null,
		duration: null,
		shuffle: false,
		repeat: 0
	},
	sleepSeconds: 0,
	eq: { preset: 1, loudness: false, bass: 0, treble: -2 }
};

export const sampleModes: Mode[] = [
	{ key: 0, id: 'IR', label: 'Internet radio', selectable: true },
	{ key: 1, id: 'Spotify', label: 'Spotify', selectable: true },
	{ key: 2, id: 'DMR', label: 'Local Music', selectable: false },
	{ key: 3, id: 'MP', label: 'Music player', selectable: true },
	{ key: 4, id: 'DAB', label: 'DAB', selectable: true },
	{ key: 5, id: 'FM', label: 'FM', selectable: true },
	{ key: 6, id: 'Bluetooth', label: 'Bluetooth', selectable: true },
	{ key: 7, id: 'AUXIN', label: 'AUX in', selectable: true }
];

export const samplePresets: Preset[] = ['Rádio Comercial', 'M80', 'FIP', 'BBC Radio 6 Music', 'FIP Pop', 'FIP Groove', 'FIP Electro'].map((name, key) => ({ key, name }));

export const sampleEqPresets: EqPreset[] = ['My EQ', 'Normal', 'Jazz', 'Rock', 'Movie', 'Classic', 'Pop', 'News'].map((label, key) => ({ key, label }));

export const sampleMenu: NavItem[] = [
	{ key: 0, name: 'Portugal', kind: 'folder', type: 0 },
	{ key: 1, name: 'Nachrichten', kind: 'folder', type: 0 },
	{ key: 2, name: 'FIP', kind: 'item', type: 2 },
	{ key: 3, name: 'M80', kind: 'item', type: 2 }
];
