<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import TransportControls from './TransportControls.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Transport" group="app">
	<Hst.Variant title="Internet radio (stop only)">
		<TransportControls caps={sampleStatus.play.caps} state="playing" onCommand={log("command")} />
	</Hst.Variant>
	<Hst.Variant title="Music player (everything)">
		<TransportControls caps={{ ...sampleStatus.play.caps, pause: true, next: true, previous: true }} state="playing" onCommand={log("command")} />
	</Hst.Variant>
	<Hst.Variant title="Paused">
		<TransportControls caps={{ ...sampleStatus.play.caps, pause: true, next: true, previous: true }} state="paused" onCommand={log("command")} />
	</Hst.Variant>
	<Hst.Variant title="Standby (disabled)">
		<TransportControls caps={sampleStatus.play.caps} state="idle" disabled onCommand={log("command")} />
	</Hst.Variant>
</Hst.Story>
