import { api } from '#lib/api.js';

class SessionStore {
	loaded = $state(false);
	admin = $state(false);
	/** False when the server has no ADMIN_TOKEN (read-only). */
	writable = $state(true);

	async load(): Promise<void> {
		try {
			const s = await api.session();
			this.admin = s.admin;
			this.writable = s.writable;
		} catch {
			this.admin = false;
		}
		this.loaded = true;
	}

	async signOut(): Promise<void> {
		await api.logout();
		this.admin = false;
	}
}

export const session = new SessionStore();
