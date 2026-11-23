<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import MenuBrowser from './MenuBrowser.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Menu browser" group="app">
	<Hst.Variant title="Folders and stations">
		<MenuBrowser items={sampleMenu} onEnter={log("enter")} onBack={log("back")} onPlay={log("play")} />
	</Hst.Variant>
	<Hst.Variant title="Loading"><MenuBrowser items={null} onEnter={log("enter")} onBack={log("back")} onPlay={log("play")} /></Hst.Variant>
	<Hst.Variant title="Empty folder"><MenuBrowser items={[]} onEnter={log("enter")} onBack={log("back")} onPlay={log("play")} /></Hst.Variant>
</Hst.Story>
