<script lang="ts">
	import type { RadioStatus } from '@radioformer/core';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import { formatDuration, STATE_LABEL } from '#lib/format.js';

	interface Props {
		status: RadioStatus;
		/** A better title than the radio's own text (for example from the broadcaster's feed). */
		title?: string;
		/** Cover or station logo address. */
		image?: string;
		album?: string;
		programme?: string;
	}
	let { status, title, image, album, programme }: Props = $props();

	const headline = $derived(title || status.play.text || status.play.name || 'Nothing playing');
	const picture = $derived(image || status.play.graphicUri);
	const sub = $derived([status.play.artist, album || status.play.album].filter(Boolean).join(' · '));
</script>

<Card.Root>
	<Card.Content class="flex gap-4">
		<div class="bg-muted flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:size-36">
			{#if picture}
				<img src={picture} alt="" class="size-full object-cover" />
			{:else}
				<RadioIcon class="text-muted-foreground size-10" />
			{/if}
		</div>
		<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
			<div class="flex flex-wrap items-center gap-2">
				<Badge variant={status.play.state === 'playing' ? 'default' : 'secondary'}>{STATE_LABEL[status.play.state] ?? status.play.state}</Badge>
				{#if status.mode}<Badge variant="outline">{status.mode.label}</Badge>{/if}
			</div>
			<p class="text-muted-foreground truncate text-sm">{status.play.name}</p>
			<h2 class="text-xl leading-tight font-semibold wrap-break-word sm:text-2xl">{headline}</h2>
			{#if sub}<p class="text-muted-foreground truncate text-sm">{sub}</p>{/if}
			{#if programme}<p class="text-muted-foreground truncate text-xs">On air: {programme}</p>{/if}
			{#if status.play.duration && status.play.position !== null}
				<p class="text-muted-foreground text-xs tabular-nums">
					{formatDuration(status.play.position)} / {formatDuration(status.play.duration)}
				</p>
			{/if}
		</div>
	</Card.Content>
</Card.Root>
