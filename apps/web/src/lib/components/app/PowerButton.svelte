<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import PowerIcon from '@lucide/svelte/icons/power';

	interface Props {
		on: boolean;
		disabled?: boolean;
		onToggle: (on: boolean) => void;
	}
	let { on, disabled = false, onToggle }: Props = $props();
</script>

<Button variant={on ? 'outline' : 'default'} {disabled} onclick={() => onToggle(!on)}>
	<PowerIcon />
	{on ? 'Standby' : 'Turn on'}
</Button>
