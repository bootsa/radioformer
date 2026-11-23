<script lang="ts">
	import type { Hst as HstApi } from '@histoire/plugin-svelte';
	import NowPlayingCard from './NowPlayingCard.svelte';
	import { sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu } from '#lib/fixtures.js';

	let { Hst }: { Hst: HstApi } = $props();
	const log = (what: string) => (...args: unknown[]) => console.log(what, ...args);
	void [sampleStatus, sampleModes, samplePresets, sampleEqPresets, sampleMenu, log];
</script>

<Hst.Story title="Remote / Now playing" group="app">
	<Hst.Variant title="Station without a title feed">
		<NowPlayingCard status={sampleStatus} />
	</Hst.Variant>
	<Hst.Variant title="Track with cover and album">
		<NowPlayingCard status={sampleStatus} title="Jane Birkin - Di doo dah" album="Quoi" programme="Club Jazzafip" image="/logo/1.png" />
	</Hst.Variant>
	<Hst.Variant title="Music player with position">
		<NowPlayingCard status={{ ...sampleStatus, play: { ...sampleStatus.play, name: "Music player", text: "Song", artist: "Artist", album: "Album", position: 65, duration: 215 } }} />
	</Hst.Variant>
</Hst.Story>
