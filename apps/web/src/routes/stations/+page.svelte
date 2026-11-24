<script lang="ts">
	import type { Station } from '@radioformer/core';
	import { toast } from 'svelte-sonner';
	import { api, ApiError, type DirectoryStation } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { session } from '#lib/stores/session.svelte.js';

	type Draft = Omit<Station, 'id'> & { id: number | null; tagsText: string };

	const blank = (): Draft => ({
		id: null,
		name: '',
		streamUrl: '',
		logoId: null,
		description: '',
		country: '',
		language: '',
		tags: [],
		tagsText: '',
		transformer: 'none',
		proxyMode: 'auto',
		collection: '',
		metadataSource: '',
		titleTemplate: '',
		directoryId: ''
	});
	const toDraft = (s: Station): Draft => ({ ...s, tagsText: s.tags.join(', ') });

	let stations = $state<Station[] | null>(null);
	let draft = $state<Draft | null>(null);
	let busy = $state(false);
	let matches = $state<DirectoryStation[] | null>(null);
	let searching = $state(false);

	const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');

	async function load() {
		try {
			stations = await api.stations();
		} catch (e) {
			toast.error(message(e));
		}
	}
	$effect(() => {
		void load();
	});

	function edit(s: Station | null) {
		matches = null;
		draft = s ? toDraft(s) : blank();
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!draft) return;
		busy = true;
		const { id, tagsText, ...rest } = draft;
		const body = { ...rest, tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) };
		try {
			if (id === null) await api.createStation(body);
			else await api.updateStation(id, body);
			toast.success('Saved');
			draft = null;
			await load();
		} catch (err) {
			toast.error(message(err));
		} finally {
			busy = false;
		}
	}

	async function remove(s: Station) {
		if (!confirm(`Delete "${s.name}"? Presets on the radio that use it will stop playing.`)) return;
		try {
			await api.deleteStation(s.id);
			if (draft?.id === s.id) draft = null;
			await load();
		} catch (e) {
			toast.error(message(e));
		}
	}

	async function findCounterpart() {
		if (!draft?.name.trim()) return toast.error('Give the station a name first');
		searching = true;
		try {
			matches = await api.directorySearch(draft.name);
			if (matches.length === 0) toast.info('Nothing with that name in the original directory');
		} catch (e) {
			toast.error(message(e));
		} finally {
			searching = false;
		}
	}

	const taken = (id: string) => stations?.find((s) => s.directoryId === id && s.id !== draft?.id);
</script>

<div class="mb-4 flex items-center gap-3">
	<h1 class="text-2xl font-semibold">Stations</h1>
	<div class="flex-1"></div>
	{#if session.admin}<Button onclick={() => edit(null)}>Add station</Button>{/if}
</div>

{#if !session.admin}
	<p class="mb-4 text-sm text-muted-foreground">Sign in to change stations.</p>
{/if}

{#if draft}
	<Card.Root class="mb-6">
		<Card.Header><Card.Title>{draft.id === null ? 'New station' : `Edit ${draft.name}`}</Card.Title></Card.Header>
		<Card.Content>
			<form class="grid gap-3 sm:grid-cols-2" onsubmit={save}>
				<div><Label for="name">Name</Label><Input id="name" required bind:value={draft.name} /></div>
				<div><Label for="url">Stream address</Label><Input id="url" required type="url" bind:value={draft.streamUrl} /></div>
				<div><Label for="collection">Folder on the radio</Label><Input id="collection" bind:value={draft.collection} /></div>
				<div><Label for="description">Description</Label><Input id="description" bind:value={draft.description} /></div>
				<div><Label for="country">Country (2 letters)</Label><Input id="country" maxlength={2} bind:value={draft.country} /></div>
				<div><Label for="language">Language</Label><Input id="language" bind:value={draft.language} /></div>
				<div class="sm:col-span-2"><Label for="tags">Tags (comma separated)</Label><Input id="tags" bind:value={draft.tagsText} /></div>
				<div>
					<Label for="proxy">How the radio gets the audio</Label>
					<select id="proxy" class="h-9 w-full rounded-md border bg-background px-2 text-sm" bind:value={draft.proxyMode}>
						<option value="auto">Automatic</option>
						<option value="direct">Directly from the stream</option>
						<option value="proxy">Through Radioformer</option>
					</select>
				</div>
				<div>
					<Label for="transformer">Title clean-up</Label>
					<select id="transformer" class="h-9 w-full rounded-md border bg-background px-2 text-sm" bind:value={draft.transformer}>
						<option value="none">None</option>
						<option value="dalet-xml">Dalet XML titles</option>
					</select>
				</div>
				<div><Label for="source">Metadata source (e.g. radiofrance:7)</Label><Input id="source" bind:value={draft.metadataSource} /></div>
				<div class="sm:col-span-2">
					<Label for="template">Title format</Label>
					<Input id="template" placeholder={'{artist} - {title}[ · On air: {programme}][ · Next: {next}]'} bind:value={draft.titleTemplate} />
					<p class="mt-1 text-xs text-muted-foreground">Parts in square brackets are left out when there is nothing to show. Empty means "Artist - Title".</p>
				</div>
				<div class="sm:col-span-2 rounded-md border p-3">
					<Label for="dirid">Id in the radio's original directory</Label>
					<div class="flex gap-2">
						<Input id="dirid" placeholder="empty: none" bind:value={draft.directoryId} />
						<Button type="button" variant="outline" disabled={searching} onclick={findCounterpart}>{searching ? 'Searching…' : 'Find by name'}</Button>
					</div>
					<p class="mt-1 text-xs text-muted-foreground">With the same id, the radio can fall back to the original station if Radioformer is ever unreachable.</p>
					{#if matches && matches.length > 0}
						<ul class="mt-2 flex max-h-64 flex-col gap-1 overflow-auto">
							{#each matches as m (m.id)}
								<li class="flex items-center gap-2 text-sm">
									{#if m.logo}<img src={m.logo} alt="" class="size-8 rounded" loading="lazy" />{/if}
									<span class="flex-1">{m.name} <span class="text-muted-foreground">{m.format} · {m.location}</span></span>
									{#if taken(m.id)}
										<span class="text-xs text-muted-foreground">used by {taken(m.id)?.name}</span>
									{:else if draft}
										<Button type="button" size="sm" variant="outline" onclick={() => { if (draft) draft.directoryId = m.id; matches = null; }}>Use</Button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<div class="flex gap-2 sm:col-span-2">
					<Button type="submit" disabled={busy}>Save</Button>
					<Button type="button" variant="ghost" onclick={() => (draft = null)}>Cancel</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
{/if}

{#if stations === null}
	<Skeleton class="h-32 w-full" />
{:else}
	<ul class="divide-y rounded-md border">
		{#each stations as s (s.id)}
			<li class="flex items-center gap-3 p-3">
				<img src={s.logoId ? `/logo/${s.logoId}.png` : '/media/default.png'} alt="" class="size-10 rounded" loading="lazy" />
				<div class="flex-1">
					<div class="font-medium">{s.name}</div>
					<div class="text-xs text-muted-foreground">
						{s.collection || 'No folder'}{s.directoryId ? ' · has an original-directory id' : ''}{s.metadataSource ? ` · ${s.metadataSource}` : ''}
					</div>
				</div>
				{#if session.admin}
					<Button variant="outline" size="sm" onclick={() => edit(s)}>Edit</Button>
					<Button variant="ghost" size="sm" onclick={() => remove(s)}>Delete</Button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
