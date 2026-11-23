<script lang="ts">
	import type { PlayCaps, PlayState, Transport } from '@radioformer/core';
	import { Button } from '#lib/components/ui/button/index.js';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import SquareIcon from '@lucide/svelte/icons/square';
	import SkipBackIcon from '@lucide/svelte/icons/skip-back';
	import SkipForwardIcon from '@lucide/svelte/icons/skip-forward';

	interface Props {
		caps: PlayCaps;
		state: PlayState;
		disabled?: boolean;
		onCommand: (command: Transport) => void;
	}
	let { caps, state, disabled = false, onCommand }: Props = $props();

	const playing = $derived(state === 'playing' || state === 'buffering' || state === 'rebuffering');
</script>

<div class="flex items-center justify-center gap-2" role="group" aria-label="Playback controls">
	<Button variant="outline" size="icon-lg" aria-label="Previous" disabled={disabled || !caps.previous} onclick={() => onCommand('previous')}>
		<SkipBackIcon />
	</Button>
	{#if playing && caps.pause}
		<Button size="icon-lg" aria-label="Pause" {disabled} onclick={() => onCommand('pause')}><PauseIcon /></Button>
	{:else if playing}
		<Button size="icon-lg" aria-label="Stop" disabled={disabled || !caps.stop} onclick={() => onCommand('stop')}><SquareIcon /></Button>
	{:else}
		<Button size="icon-lg" aria-label="Play" {disabled} onclick={() => onCommand('play')}><PlayIcon /></Button>
	{/if}
	{#if playing && caps.pause && caps.stop}
		<Button variant="outline" size="icon-lg" aria-label="Stop" {disabled} onclick={() => onCommand('stop')}><SquareIcon /></Button>
	{/if}
	<Button variant="outline" size="icon-lg" aria-label="Next" disabled={disabled || !caps.next} onclick={() => onCommand('next')}>
		<SkipForwardIcon />
	</Button>
</div>
