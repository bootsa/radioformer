<script lang="ts">
	import type { Preset } from '@radioformer/core';
	import { Button } from '#lib/components/ui/button/index.js';

	interface Props {
		presets: Preset[];
		/** Name of what is playing now, to highlight a matching preset. */
		playing?: string;
		disabled?: boolean;
		onSelect: (key: number) => void;
	}
	let { presets, playing = '', disabled = false, onSelect }: Props = $props();
</script>

{#if presets.length === 0}
	<p class="text-muted-foreground text-sm">No presets saved for this source.</p>
{:else}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
		{#each presets as p (p.key)}
			<Button
				variant={playing && p.name === playing ? 'default' : 'outline'}
				class="h-auto justify-start py-2 text-left whitespace-normal"
				{disabled}
				onclick={() => onSelect(p.key)}
			>
				<span class="text-muted-foreground w-5 shrink-0 text-xs tabular-nums">{p.key + 1}</span>
				<span class="min-w-0 flex-1 wrap-break-word">{p.name}</span>
			</Button>
		{/each}
	</div>
{/if}
