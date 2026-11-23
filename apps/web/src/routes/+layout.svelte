<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { ModeWatcher, toggleMode } from 'mode-watcher';
	import { goto } from '$app/navigation';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { session } from '#lib/stores/session.svelte.js';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	async function signOut() {
		await session.signOut();
		await goto('/login');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Radioformer</title>
</svelte:head>

<ModeWatcher />
<Toaster richColors position="top-center" />

<header class="border-b">
	<div class="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
		<a href="/" class="flex items-center gap-2 font-semibold"><RadioIcon class="size-5" /> Radioformer</a>
		<div class="flex-1"></div>
		<Button variant="ghost" size="icon" aria-label="Toggle dark mode" onclick={toggleMode}>
			<SunIcon class="dark:hidden" /><MoonIcon class="hidden dark:block" />
		</Button>
		{#if session.admin}<Button variant="ghost" size="sm" onclick={signOut}>Sign out</Button>{/if}
	</div>
</header>

<main class="mx-auto max-w-4xl p-4 sm:p-6">
	{@render children()}
</main>
