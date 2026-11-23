<script lang="ts">
	import type { Hst } from '@histoire/plugin-svelte';
	import { Button } from '#lib/components/ui/button/index.js';

	let { Hst }: { Hst: Hst } = $props();

	const variants = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;
	const sizes = ['default', 'sm', 'lg'] as const;

	let variant: (typeof variants)[number] = $state('default');
	let size: (typeof sizes)[number] = $state('default');
	let label = $state('Play station');
	let disabled = $state(false);
</script>

<Hst.Story title="Button" group="ui" layout={{ type: 'grid', width: 220 }}>
	<Hst.Variant title="Playground">
		<Button {variant} {size} {disabled}>{label}</Button>

		{#snippet controls()}
			<Hst.Select bind:value={variant} title="Variant" options={variants} />
			<Hst.Select bind:value={size} title="Size" options={sizes} />
			<Hst.Text bind:value={label} title="Label" />
			<Hst.Checkbox bind:value={disabled} title="Disabled" />
		{/snippet}
	</Hst.Variant>

	{#each variants as v (v)}
		<Hst.Variant title={v}>
			<Button variant={v}>{v}</Button>
		</Hst.Variant>
	{/each}
</Hst.Story>
