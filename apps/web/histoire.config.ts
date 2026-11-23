import { HstSvelte } from '@histoire/plugin-svelte';
import { defineConfig } from 'histoire';

export default defineConfig({
	plugins: [HstSvelte()],
	setupFile: 'src/histoire.setup.ts',
	storyMatch: ['src/**/*.story.svelte'],
	outDir: '.histoire/dist',
	theme: {
		title: 'Radioformer components'
	},
	tree: {
		groups: [
			{ id: 'top', title: '' },
			{ id: 'ui', title: 'UI (shadcn-svelte)' },
			{ id: 'app', title: 'App' }
		]
	}
});
