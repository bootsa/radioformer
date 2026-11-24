import type { EqPreset, Mode, NavItem, NowPlaying, Preset, RadioInfo, RadioStatus, Station } from '@radioformer/core';

/** A station of the radio's original directory. */
export interface DirectoryStation {
	id: string;
	name: string;
	format: string;
	location: string;
	logo: string;
}

export class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(path, {
		credentials: 'same-origin',
		...init,
		headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
	});
	if (!res.ok) {
		let message = res.statusText;
		try {
			message = ((await res.json()) as { error?: string }).error ?? message;
		} catch {
			/* not JSON */
		}
		throw new ApiError(message, res.status);
	}
	return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** Commands the Remote page can send (mirrors the server's command schema). */
export type Command =
	| { type: 'power'; on: boolean }
	| { type: 'volume'; level: number }
	| { type: 'mute'; muted: boolean }
	| { type: 'mode'; key: number }
	| { type: 'transport'; command: 'stop' | 'play' | 'pause' | 'next' | 'previous' }
	| { type: 'shuffle'; on: boolean }
	| { type: 'repeat'; mode: number }
	| { type: 'sleep'; seconds: number }
	| { type: 'eq'; preset?: number; loudness?: boolean; bass?: number; treble?: number }
	| { type: 'preset'; key: number }
	| { type: 'enter'; key: number }
	| { type: 'back' }
	| { type: 'play'; key: number }
	| { type: 'closeMenu' };

export const api = {
	session: () => request<{ admin: boolean; writable: boolean }>('/api/v1/session'),
	login: (token: string) => request<{ admin: boolean }>('/api/v1/login', post({ token })),
	logout: () => request<{ admin: boolean }>('/api/v1/logout', post({})),
	radios: () => request<RadioInfo[]>('/api/v1/radios'),
	updateRadio: (id: number, patch: { label?: string; host?: string; pin?: string }) =>
		request<RadioInfo>(`/api/v1/radios/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	status: (id: number) => request<RadioStatus>(`/api/v1/radios/${id}/status`),
	modes: (id: number) => request<Mode[]>(`/api/v1/radios/${id}/modes`),
	presets: (id: number) => request<Preset[]>(`/api/v1/radios/${id}/presets`),
	eqPresets: (id: number) => request<EqPreset[]>(`/api/v1/radios/${id}/eq-presets`),
	menu: (id: number) => request<NavItem[]>(`/api/v1/radios/${id}/menu`),
	command: (id: number, cmd: Command) => request<{ ok?: boolean; menu?: NavItem[] }>(`/api/v1/radios/${id}/command`, post(cmd)),
	stations: () => request<Station[]>('/api/v1/stations'),
	createStation: (s: Omit<Station, 'id'>) => request<Station>('/api/v1/stations', post(s)),
	updateStation: (id: number, s: Omit<Station, 'id'>) => request<Station>(`/api/v1/stations/${id}`, { method: 'PUT', body: JSON.stringify(s) }),
	deleteStation: (id: number) => request<void>(`/api/v1/stations/${id}`, { method: 'DELETE' }),
	setStationLogo: (id: number, url: string) => request<{ logoId: number }>(`/api/v1/stations/${id}/logo`, post({ url })),
	directorySearch: (q: string) => request<DirectoryStation[]>(`/api/v1/directory/search?q=${encodeURIComponent(q)}`),
	nowPlaying: (stationId: number) => request<NowPlaying>(`/api/v1/stations/${stationId}/now-playing`)
};

export interface Watcher {
	close(): void;
}

/** Live status of a radio over server-sent events; reconnects by itself when the connection drops. */
export function watchRadio(id: number, on: { status: (s: RadioStatus) => void; problem: (message: string) => void }): Watcher {
	const source = new EventSource(`/api/v1/radios/${id}/events`);
	source.addEventListener('status', (e) => on.status(JSON.parse((e as MessageEvent<string>).data) as RadioStatus));
	source.addEventListener('problem', (e) => on.problem((JSON.parse((e as MessageEvent<string>).data) as { error: string }).error));
	return { close: () => source.close() };
}
