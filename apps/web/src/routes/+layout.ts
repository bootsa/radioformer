import { redirect } from '@sveltejs/kit';
import { session } from '#lib/stores/session.svelte.js';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ url }) => {
	if (!session.loaded) await session.load();
	if (!session.admin && url.pathname !== '/login') redirect(307, '/login');
	if (session.admin && url.pathname === '/login') redirect(307, '/');
};
