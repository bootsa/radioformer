<script lang="ts">
	import type { NavItem } from '@radioformer/core';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import PlayIcon from '@lucide/svelte/icons/play';

	interface Props {
		items: NavItem[] | null;
		busy?: boolean;
		onEnter: (key: number) => void;
		onBack: () => void;
		onPlay: (key: number) => void;
	}
	let { items, busy = false, onEnter, onBack, onPlay }: Props = $props();
</script>

<div class="flex flex-col gap-1">
	<Button variant="ghost" size="sm" class="self-start" disabled={busy} onclick={onBack}>
		<ChevronLeftIcon /> Back
	</Button>
	{#if items === null}
		{#each [0, 1, 2, 3] as i (i)}<Skeleton class="h-9 w-full" />{/each}
	{:else if items.length === 0}
		<p class="text-muted-foreground text-sm">This folder is empty.</p>
	{:else}
		<ul class="flex max-h-96 flex-col overflow-y-auto" aria-label="Radio menu">
			{#each items as item (item.key)}
				<li>
					<Button
						variant="ghost"
						class="w-full justify-start"
						disabled={busy || item.kind === 'loading'}
						onclick={() => (item.kind === 'folder' ? onEnter(item.key) : onPlay(item.key))}
					>
						{#if item.kind === 'folder'}<FolderIcon />{:else}<PlayIcon />{/if}
						<span class="truncate">{item.name || 'Loading…'}</span>
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
