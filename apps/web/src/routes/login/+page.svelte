<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, ApiError } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { session } from '#lib/stores/session.svelte.js';

	let token = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			await api.login(token);
			session.admin = true;
			await goto('/');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not reach the server';
		} finally {
			busy = false;
		}
	}
</script>

<div class="mx-auto mt-10 max-w-sm">
	<Card.Root>
		<Card.Header>
			<Card.Title>Sign in</Card.Title>
			<Card.Description>
				{#if session.writable}Enter the admin token of this Radioformer server.{:else}This server has no admin token set, so it is read-only. Set <code>ADMIN_TOKEN</code> to sign in.{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form class="flex flex-col gap-3" onsubmit={submit}>
				<Label for="token">Admin token</Label>
				<Input id="token" type="password" autocomplete="current-password" bind:value={token} disabled={!session.writable} />
				{#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
				<Button type="submit" disabled={busy || !token || !session.writable}>Sign in</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
