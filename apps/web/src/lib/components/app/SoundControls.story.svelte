<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import SoundControls from './SoundControls.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Sound" group="app">
	<Hst.Variant title="Default">
		<SoundControls eq={sampleStatus.eq} presets={sampleEqPresets} onChange={log("eq")} />
	</Hst.Variant>
	<Hst.Variant title="Disabled">
		<SoundControls eq={sampleStatus.eq} presets={sampleEqPresets} disabled onChange={log("eq")} />
	</Hst.Variant>
</Hst.Story>
