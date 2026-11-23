<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import SleepTimer from './SleepTimer.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Sleep timer" group="app">
	<Hst.Variant title="Off"><SleepTimer seconds={0} onChange={log("sleep")} /></Hst.Variant>
	<Hst.Variant title="30 minutes"><SleepTimer seconds={1800} onChange={log("sleep")} /></Hst.Variant>
	<Hst.Variant title="Odd value running"><SleepTimer seconds={1234} onChange={log("sleep")} /></Hst.Variant>
</Hst.Story>
