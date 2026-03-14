<script lang="ts">
	import { resolve } from '$app/paths';
	import { MODE_CONFIGS } from '$lib/ui/mode-config';
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
	<header class="text-center">
		<h1 class="text-4xl font-bold">Flappy Bird Control Lab</h1>
		<p class="mt-2 text-lg text-gray-600">
			Learn control theory by playing — and automating — a Flappy Bird inspired game.
		</p>
	</header>

	<section class="flex flex-col items-center gap-4">
		<a
			href={resolve('/game')}
			class="rounded-lg bg-blue-600 px-8 py-4 text-lg font-semibold text-white hover:bg-blue-700"
		>
			Play the Game
		</a>
		<a
			href={resolve('/analysis')}
			class="rounded-lg bg-gray-200 px-8 py-4 text-lg font-semibold text-gray-800 hover:bg-gray-300"
		>
			Analysis View
		</a>
	</section>

	<section class="max-w-xl">
		<h2 class="mb-3 text-xl font-semibold">Game modes</h2>
		<ul class="space-y-2">
			{#each Object.entries(MODE_CONFIGS) as [key, config] (key)}
				<li class="rounded border p-3">
					<strong>{config.label}</strong>
					<span class="ml-2 text-sm text-gray-600">{config.description}</span>
				</li>
			{/each}
		</ul>
	</section>
</main>
