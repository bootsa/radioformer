<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';

	let health = $state<'checking' | 'ok' | 'down'>('checking');

	$effect(() => {
		fetch('/healthz')
			.then((r) => (health = r.ok ? 'ok' : 'down'))
			.catch(() => (health = 'down'));
	});
</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
	<h1 class="text-3xl font-semibold tracking-tight">Radioformer</h1>
	<p class="text-muted-foreground">
		A small server for Frontier Silicon internet radios. This page is the start of the web app; the
		library, search and radios screens come with milestone M2.
	</p>
	<div class="flex items-center gap-3">
		<Button>Open library</Button>
		<Button variant="outline" disabled>Search stations</Button>
		<span class="text-muted-foreground text-sm">
			Server: {health === 'checking' ? 'checking…' : health === 'ok' ? 'running' : 'not reachable'}
		</span>
	</div>
</main>
