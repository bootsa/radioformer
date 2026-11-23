<script lang="ts">
	import type { Mode } from '@radioformer/core';
	import { Button } from '#lib/components/ui/button/index.js';

	interface Props {
		modes: Mode[];
		current: number | null;
		disabled?: boolean;
		onSelect: (key: number) => void;
	}
	let { modes, current, disabled = false, onSelect }: Props = $props();
</script>

<div class="flex flex-wrap gap-2" role="group" aria-label="Source">
	{#each modes.filter((m) => m.selectable || m.key === current) as m (m.key)}
		<Button
			variant={m.key === current ? 'default' : 'outline'}
			size="sm"
			disabled={disabled || (!m.selectable && m.key !== current)}
			aria-pressed={m.key === current}
			onclick={() => onSelect(m.key)}
		>
			{m.label}
		</Button>
	{/each}
</div>
