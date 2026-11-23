<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import PresetGrid from './PresetGrid.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Presets" group="app">
	<Hst.Variant title="With a preset playing">
		<PresetGrid presets={samplePresets} playing="FIP" onSelect={log("preset")} />
	</Hst.Variant>
	<Hst.Variant title="Empty">
		<PresetGrid presets={[]} onSelect={log("preset")} />
	</Hst.Variant>
</Hst.Story>
