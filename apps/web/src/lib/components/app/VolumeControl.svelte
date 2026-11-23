<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';

	interface Props {
		volume: number;
		/** Number of steps the radio reports (volume runs 0 to steps - 1). */
		steps: number;
		muted: boolean;
		disabled?: boolean;
		onChange: (level: number) => void;
		onMute: (muted: boolean) => void;
	}
	let { volume, steps, muted, disabled = false, onChange, onMute }: Props = $props();

	const max = $derived(Math.max(1, steps - 1));
	let local = $state<number | null>(null);
	const shown = $derived(local ?? volume);
</script>

<div class="flex items-center gap-3">
	<Button variant="ghost" size="icon" aria-label={muted ? 'Unmute' : 'Mute'} {disabled} onclick={() => onMute(!muted)}>
		{#if muted}<VolumeXIcon />{:else}<Volume2Icon />{/if}
	</Button>
	<Slider
		type="single"
		value={shown}
		{max}
		step={1}
		{disabled}
		aria-label="Volume"
		onValueChange={(v: number) => (local = v)}
		onValueCommit={(v: number) => {
			local = null;
			onChange(v);
		}}
	/>
	<span class="w-8 text-right text-sm tabular-nums" aria-live="polite">{shown}</span>
</div>
