<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import ModePicker from './ModePicker.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Source" group="app">
	<Hst.Variant title="Internet radio selected">
		<ModePicker modes={sampleModes} current={0} onSelect={log("mode")} />
	</Hst.Variant>
	<Hst.Variant title="Local Music (UPnP) active">
		<ModePicker modes={sampleModes} current={2} onSelect={log("mode")} />
	</Hst.Variant>
</Hst.Story>
