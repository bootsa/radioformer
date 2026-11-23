<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import VolumeControl from './VolumeControl.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Volume" group="app">
	<Hst.Variant title="Normal">
		<VolumeControl volume={7} steps={33} muted={false} onChange={log("volume")} onMute={log("mute")} />
	</Hst.Variant>
	<Hst.Variant title="Muted">
		<VolumeControl volume={7} steps={33} muted onChange={log("volume")} onMute={log("mute")} />
	</Hst.Variant>
	<Hst.Variant title="Disabled">
		<VolumeControl volume={0} steps={33} muted={false} disabled onChange={log("volume")} onMute={log("mute")} />
	</Hst.Variant>
</Hst.Story>
