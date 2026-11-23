<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { formatSleep } from '#lib/format.js';

	interface Props {
		seconds: number;
		disabled?: boolean;
		onChange: (seconds: number) => void;
	}
	let { seconds, disabled = false, onChange }: Props = $props();
	const OPTIONS = [0, 900, 1800, 3600, 5400, 7200];
</script>

<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Sleep timer">
	{#each OPTIONS as s (s)}
		<Button variant={s === seconds ? 'default' : 'outline'} size="sm" {disabled} aria-pressed={s === seconds} onclick={() => onChange(s)}>
			{formatSleep(s)}
		</Button>
	{/each}
	{#if seconds > 0 && !OPTIONS.includes(seconds)}
		<span class="text-muted-foreground text-sm">Running: {formatSleep(seconds)}</span>
	{/if}
</div>
