<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import PowerButton from './PowerButton.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Power" group="app">
	<Hst.Variant title="On"><PowerButton on onToggle={log("power")} /></Hst.Variant>
	<Hst.Variant title="Standby"><PowerButton on={false} onToggle={log("power")} /></Hst.Variant>
</Hst.Story>
