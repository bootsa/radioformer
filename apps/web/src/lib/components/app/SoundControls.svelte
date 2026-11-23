<script lang="ts">
	import type { EqPreset } from '@radioformer/core';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';

	interface Props {
		eq: { preset: number; loudness: boolean; bass: number; treble: number };
		presets: EqPreset[];
		disabled?: boolean;
		onChange: (change: { preset?: number; loudness?: boolean; bass?: number; treble?: number }) => void;
	}
	let { eq, presets, disabled = false, onChange }: Props = $props();
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap gap-2" role="group" aria-label="Equaliser preset">
		{#each presets as p (p.key)}
			<Button variant={p.key === eq.preset ? 'default' : 'outline'} size="sm" {disabled} aria-pressed={p.key === eq.preset} onclick={() => onChange({ preset: p.key })}>
				{p.label}
			</Button>
		{/each}
	</div>
	{#each [{ id: 'bass', label: 'Bass', value: eq.bass }, { id: 'treble', label: 'Treble', value: eq.treble }] as band (band.id)}
		<div class="flex items-center gap-3">
			<Label class="w-14">{band.label}</Label>
			<Slider
				type="single"
				value={band.value}
				min={-7}
				max={7}
				step={1}
				{disabled}
				aria-label={band.label}
				onValueCommit={(v: number) => onChange(band.id === 'bass' ? { bass: v } : { treble: v })}
			/>
			<span class="w-8 text-right text-sm tabular-nums">{band.value > 0 ? '+' : ''}{band.value}</span>
		</div>
	{/each}
	<div class="flex items-center gap-3">
		<Switch id="loudness" checked={eq.loudness} {disabled} onCheckedChange={(v: boolean) => onChange({ loudness: v })} />
		<Label for="loudness">Loudness</Label>
	</div>
</div>
