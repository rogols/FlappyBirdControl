<script lang="ts">
	import { resolve } from '$app/paths';
	// Analysis view — Phase 2 implementation target.
	// This page will host step response, Bode, and pole-zero plots.
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
	<h1 class="text-3xl font-bold">Analysis View</h1>
	<p class="text-gray-600">Analysis view coming soon.</p>
	<p class="text-sm text-gray-400">
		Step response, Bode plots, and pole-zero maps will appear here in Phase 2.
	</p>
	<a href={resolve('/')} class="mt-4 rounded bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300">
		Back to home
	</a>
</main>
