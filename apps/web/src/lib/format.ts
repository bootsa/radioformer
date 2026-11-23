/** "3:05" for 185 seconds; "1:02:03" past an hour. */
export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Sleep timer label: "Off", "30 min", "1 h 30 min". */
export function formatSleep(seconds: number): string {
	if (seconds <= 0) return 'Off';
	const m = Math.round(seconds / 60);
	return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

export const STATE_LABEL: Record<string, string> = {
	idle: 'Idle',
	buffering: 'Buffering',
	playing: 'Playing',
	paused: 'Paused',
	rebuffering: 'Buffering',
	error: 'Problem',
	stopped: 'Stopped'
};
