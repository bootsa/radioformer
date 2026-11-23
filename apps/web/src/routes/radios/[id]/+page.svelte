<script lang="ts">
	import { page } from '$app/state';
	import type { EqPreset, Mode, NavItem, NowPlaying, Preset, RadioStatus, Station, Transport } from '@radioformer/core';
	import { toast } from 'svelte-sonner';
	import { api, ApiError, watchRadio, type Command } from '#lib/api.js';
	import { NO_PRESET_SOURCES } from '#lib/format.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import MenuBrowser from '#lib/components/app/MenuBrowser.svelte';
	import ModePicker from '#lib/components/app/ModePicker.svelte';
	import NowPlayingCard from '#lib/components/app/NowPlayingCard.svelte';
	import PowerButton from '#lib/components/app/PowerButton.svelte';
	import PresetGrid from '#lib/components/app/PresetGrid.svelte';
	import SleepTimer from '#lib/components/app/SleepTimer.svelte';
	import SoundControls from '#lib/components/app/SoundControls.svelte';
	import TransportControls from '#lib/components/app/TransportControls.svelte';
	import VolumeControl from '#lib/components/app/VolumeControl.svelte';

	const id = $derived(Number(page.params.id));

	let status = $state<RadioStatus | null>(null);
	let problem = $state('');
	let modes = $state<Mode[]>([]);
	let presets = $state<Preset[] | null>(null);
	let eqPresets = $state<EqPreset[]>([]);
	let stations = $state<Station[]>([]);
	let nowPlaying = $state<NowPlaying | null>(null);
	let menu = $state<NavItem[] | null>(null);
	let menuBusy = $state(false);
	let tab = $state('presets');

	const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');

	// live status
	$effect(() => {
		const watcher = watchRadio(id, {
			status: (s) => {
				status = s;
				problem = '';
			},
			problem: (m) => (problem = m)
		});
		return () => watcher.close();
	});

	// lists that rarely change
	$effect(() => {
		void api.modes(id).then((m) => (modes = m)).catch(() => {});
		void api.eqPresets(id).then((p) => (eqPresets = p)).catch(() => {});
		void api.stations().then((s) => (stations = s)).catch(() => {});
		void loadPresets();
	});

	let presetsToken = 0;
	let presetsTimer: ReturnType<typeof setTimeout> | undefined;
	let presetsNote = $state('');
	const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

	/** The radio needs a moment to load its list after a mode switch; the latest request wins and waits patiently. */
	async function loadPresets(retries = 6) {
		const token = ++presetsToken;
		presets = null;
		presetsNote = '';
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const list = await api.presets(id);
				if (token === presetsToken) presets = list;
				return;
			} catch (e) {
				if (token !== presetsToken) return;
				const msg = message(e);
				const stillLoading = /still loading|blocked/i.test(msg);
				if (!stillLoading || attempt === retries) {
					presets = [];
					if (stillLoading) presetsNote = 'The radio is still loading this list. Switch tabs or reload in a moment.';
					else toast.error(msg);
					return;
				}
				await sleep(2000);
			}
		}
	}

	function reloadPresetsSoon() {
		presetsToken++; // drop whatever is loading now
		presets = null;
		clearTimeout(presetsTimer);
		presetsTimer = setTimeout(() => void loadPresets(), 2500);
	}

	// the broadcaster's own feed, when the playing station has one
	const station = $derived(stations.find((s) => s.name === status?.play.name));
	$effect(() => {
		const s = station;
		nowPlaying = null;
		if (!s?.metadataSource) return;
		let alive = true;
		const load = () => api.nowPlaying(s.id).then((np) => alive && (nowPlaying = np)).catch(() => {});
		void load();
		const timer = setInterval(load, 15_000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	});

	const image = $derived(nowPlaying?.track?.cover || (station?.logoId ? `/logo/${station.logoId}.png` : undefined));

	async function send(cmd: Command, then?: () => void) {
		try {
			const res = await api.command(id, cmd);
			if (res.menu) menu = res.menu;
			then?.();
		} catch (e) {
			toast.error(message(e));
		}
	}

	const patch = (change: Partial<RadioStatus>) => {
		if (status) status = { ...status, ...change };
	};

	async function openMenu() {
		if (menu) return;
		try {
			menu = await api.menu(id);
		} catch (e) {
			menu = [];
			toast.error(message(e));
		}
	}

	async function menuAction(cmd: Command) {
		menuBusy = true;
		await send(cmd);
		menuBusy = false;
	}

	$effect(() => {
		if (tab === 'browse') void openMenu();
	});
</script>

{#if status === null}
	<div class="flex flex-col gap-4">
		{#if problem}<p class="text-destructive" role="alert">{problem}</p>{/if}
		<Skeleton class="h-40 w-full" />
		<Skeleton class="h-24 w-full" />
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-2">
			<h1 class="text-2xl font-semibold">{status.name || 'Radio'}</h1>
			<PowerButton on={status.power} onToggle={(on) => { patch({ power: on }); void send({ type: 'power', on }); }} />
		</div>

		{#if problem}<p class="text-destructive text-sm" role="alert">Lost contact with the radio: {problem}</p>{/if}

		<NowPlayingCard
			{status}
			{...nowPlaying?.title ? { title: nowPlaying.title } : {}}
			{...image ? { image } : {}}
			{...nowPlaying?.track?.album ? { album: nowPlaying.track.album } : {}}
			{...nowPlaying?.programme?.title ? { programme: nowPlaying.programme.title } : {}}
		/>

		<Card.Root>
			<Card.Content class="flex flex-col gap-4">
				<TransportControls
					caps={status.play.caps}
					state={status.play.state}
					disabled={!status.power}
					onCommand={(command: Transport) => void send({ type: 'transport', command })}
				/>
				<VolumeControl
					volume={status.volume}
					steps={status.volumeSteps}
					muted={status.muted}
					disabled={!status.power}
					onChange={(level) => { patch({ volume: level }); void send({ type: 'volume', level }); }}
					onMute={(muted) => { patch({ muted }); void send({ type: 'mute', muted }); }}
				/>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>Source</Card.Title></Card.Header>
			<Card.Content>
				<ModePicker
					{modes}
					current={status.mode?.key ?? null}
					disabled={!status.power}
					onSelect={(key) => void send({ type: 'mode', key }, reloadPresetsSoon)}
				/>
			</Card.Content>
		</Card.Root>

		<Tabs.Root bind:value={tab}>
			<Tabs.List>
				<Tabs.Trigger value="presets">Presets</Tabs.Trigger>
				<Tabs.Trigger value="browse">Browse</Tabs.Trigger>
				<Tabs.Trigger value="sound">Sound</Tabs.Trigger>
				<Tabs.Trigger value="timer">Sleep timer</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="presets" class="pt-3">
				{#if presets === null}
					<Skeleton class="h-24 w-full" />
				{:else}
					<PresetGrid
						{presets}
						playing={status.play.name}
						disabled={!status.power}
						emptyMessage={NO_PRESET_SOURCES.includes(status.mode?.id ?? '') ? 'This source has no presets.' : presetsNote || 'No presets saved for this source.'}
						onSelect={(key) => void send({ type: 'preset', key })}
					/>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="browse" class="pt-3">
				<MenuBrowser
					items={menu}
					busy={menuBusy}
					onEnter={(key) => void menuAction({ type: 'enter', key })}
					onBack={() => void menuAction({ type: 'back' })}
					onPlay={(key) => void menuAction({ type: 'play', key })}
				/>
			</Tabs.Content>
			<Tabs.Content value="sound" class="pt-3">
				<SoundControls
					eq={status.eq}
					presets={eqPresets}
					disabled={!status.power}
					onChange={(change) => { patch({ eq: { ...status!.eq, ...change } }); void send({ type: 'eq', ...change }); }}
				/>
			</Tabs.Content>
			<Tabs.Content value="timer" class="pt-3">
				<SleepTimer seconds={status.sleepSeconds} disabled={!status.power} onChange={(seconds) => { patch({ sleepSeconds: seconds }); void send({ type: 'sleep', seconds }); }} />
			</Tabs.Content>
		</Tabs.Root>

		<p class="text-muted-foreground text-xs">
			Signal {status.signal ?? '?'}% · firmware {status.version}
		</p>
	</div>
{/if}
