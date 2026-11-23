<script lang="ts">
	import type { RadioInfo } from '@radioformer/core';
	import { toast } from 'svelte-sonner';
	import { api, ApiError } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';

	let radios = $state<RadioInfo[] | null>(null);
	let hosts = $state<Record<number, string>>({});

	$effect(() => {
		api.radios().then((r) => {
			radios = r;
			hosts = Object.fromEntries(r.map((x) => [x.id, x.host]));
		}).catch((e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Could not load radios'));
	});

	async function saveHost(radio: RadioInfo) {
		try {
			const updated = await api.updateRadio(radio.id, { host: hosts[radio.id]?.trim() ?? '' });
			radios = (radios ?? []).map((r) => (r.id === updated.id ? updated : r));
			toast.success('Address saved');
		} catch (e) {
			toast.error(e instanceof ApiError ? e.message : 'Could not save');
		}
	}
</script>

<h1 class="mb-4 text-2xl font-semibold">Radios</h1>

{#if radios === null}
	<Skeleton class="h-32 w-full" />
{:else if radios.length === 0}
	<Card.Root>
		<Card.Content>
			<p class="text-muted-foreground">No radio has connected yet. Point a radio's DNS at this server and open Internet radio; it will appear here.</p>
		</Card.Content>
	</Card.Root>
{:else}
	<div class="grid gap-4 sm:grid-cols-2">
		{#each radios as radio (radio.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title>{radio.label || `Radio ${radio.id}`}</Card.Title>
					<Card.Description>Last seen {radio.lastSeen} UTC</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<form class="flex items-end gap-2" onsubmit={(e) => { e.preventDefault(); void saveHost(radio); }}>
						<div class="flex-1">
							<Label for={`host-${radio.id}`}>Address of the radio</Label>
							<Input id={`host-${radio.id}`} placeholder="192.168.222.223" bind:value={hosts[radio.id]} />
						</div>
						<Button type="submit" variant="outline">Save</Button>
					</form>
					<Button href={`/radios/${radio.id}`} disabled={!radio.host}>Open remote</Button>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
{/if}
