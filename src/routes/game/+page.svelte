<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import { GameEngine, DEFAULT_GAME_CONFIG } from '$lib/game/engine';
	import { GameScene } from '$lib/game/scene-three';
	import type { OverlayData } from '$lib/game/scene-three';
	import { gameMode, gameRunning, activeController } from '$lib/ui/stores';
	import { MODE_CONFIGS } from '$lib/ui/mode-config';
	import { OnOffController } from '$lib/control/onoff-controller';
	import { PIDController } from '$lib/control/pid-controller';
	import { TFController, DEFAULT_TF_PARAMS } from '$lib/control/tf-controller';
	import type { GameMode } from '$lib/ui/stores';
	import { TelemetryRecorder } from '$lib/telemetry/recorder';
	import { saveHighScore, getHighScores } from '$lib/persistence/highscore-store';
	import type { HighScore } from '$lib/persistence/highscore-store';
	import { getAllPresets } from '$lib/persistence/preset-store';
	import type { ControllerPreset } from '$lib/persistence/preset-store';

	/** Setpoint — target bird height (world units). Midpoint of [0, 10] range. */
	const SETPOINT = 5.0;
	/** Flap impulse force applied in manual mode (N) */
	const FLAP_FORCE = 25.0;
	/** Max control force used to normalise the effort bar (N) */
	const MAX_CONTROL = 40.0;
	/** Speed multiplier options (simulation time / wall-clock time) */
	const SPEED_OPTIONS = [1, 2, 4, 8] as const;
	/** Number of telemetry samples shown in the mini-chart */
	const CHART_SAMPLES = 180;

	let canvas: HTMLCanvasElement | undefined = $state();
	let engine: GameEngine | null = null;
	let scene: GameScene | null = null;
	let animFrameId: number | null = null;
	let lastTimestamp: number | null = null;

	/** Telemetry ring buffer — 1200 samples ≈ 20 s at 60 Hz */
	const recorder = new TelemetryRecorder(1200);

	let score = $state(0);
	let alive = $state(true);
	let running = $derived($gameRunning);
	let currentMode = $derived($gameMode);
	let speedMultiplier = $state<1 | 2 | 4 | 8>(1);

	/** Latest controller internals for PID/TF overlay */
	let latestInternals: Record<string, number> | undefined = $state(undefined);

	/** Mini-chart data — last CHART_SAMPLES error values */
	let chartSamples: number[] = $state([]);

	/** Run start time (seconds) used to compute durationSec on game-over */
	let runStartTime: number | null = null;

	/** Top-3 high scores for the current mode (refreshed on game-over and mode change) */
	let topScores: HighScore[] = $state([]);

	/** All available presets (built-ins + user-saved) */
	let allPresets: ControllerPreset[] = $state(getAllPresets());

	/** Presets relevant to the current mode */
	let modePresets = $derived(allPresets.filter((p) => p.config.mode === currentMode));

	function refreshTopScores(): void {
		topScores = getHighScores($gameMode).slice(0, 3);
	}

	function createControllerForMode(mode: GameMode) {
		switch (mode) {
			case 'auto-onoff':
				return new OnOffController({ highOutput: 30, lowOutput: 0, threshold: 0, hysteresis: 0.3 });
			case 'auto-pid':
				return new PIDController({ kp: 8, ki: 1, kd: 2, outputMin: 0, outputMax: 40 });
			case 'auto-tf': {
				// Use controller already set from analysis view if present, otherwise default
				const existing = $activeController;
				if (existing instanceof TFController) return existing;
				const ctrl = new TFController({ ...DEFAULT_TF_PARAMS });
				return ctrl;
			}
			default:
				return null;
		}
	}

	/** Apply a preset — creates a new controller from preset params and updates stores */
	function applyPreset(preset: ControllerPreset): void {
		const cfg = preset.config;
		let ctrl: OnOffController | PIDController | TFController | null = null;

		if (cfg.mode === 'auto-onoff') {
			ctrl = new OnOffController(cfg.params);
		} else if (cfg.mode === 'auto-pid') {
			ctrl = new PIDController(cfg.params);
		} else if (cfg.mode === 'auto-tf') {
			ctrl = new TFController(cfg.params);
		}

		if (!ctrl) return;

		gameMode.set(cfg.mode);
		activeController.set(ctrl);
		ctrl.reset();

		// Restart game with the new controller if running
		if ($gameRunning) {
			stopGame();
			startGame();
		}

		refreshTopScores();
	}

	function startGame() {
		if (!canvas) return;

		// Initialise or reset engine
		engine = new GameEngine(DEFAULT_GAME_CONFIG);
		engine.start();

		// Initialise or reset scene
		if (!scene) {
			scene = new GameScene();
			scene.init(canvas);
		}

		// Set up controller for current mode
		const controller = createControllerForMode($gameMode);
		activeController.set(controller);
		if (controller) {
			controller.reset();
		}

		// Reset telemetry for the new run
		recorder.clear();
		chartSamples = [];
		latestInternals = undefined;
		runStartTime = null;

		gameRunning.set(true);
		alive = true;
		score = 0;
		lastTimestamp = null;

		refreshTopScores();

		// Start render/simulation loop
		if (animFrameId !== null) {
			cancelAnimationFrame(animFrameId);
		}
		animFrameId = requestAnimationFrame(loop);
	}

	function stopGame() {
		gameRunning.set(false);
		if (engine) engine.stop();
		if (animFrameId !== null) {
			cancelAnimationFrame(animFrameId);
			animFrameId = null;
		}
	}

	function loop(timestamp: number) {
		if (!$gameRunning) return;

		const rawWallDt = lastTimestamp !== null ? (timestamp - lastTimestamp) / 1000 : 0;
		lastTimestamp = timestamp;

		// Apply speed multiplier: advance simulation faster than wall-clock
		const wallDt = rawWallDt * speedMultiplier;

		if (engine && wallDt > 0) {
			const state = engine.getState();

			// Track run start time for duration calculation
			if (runStartTime === null) {
				runStartTime = state.time;
			}

			// In auto mode: run controller and feed output to engine
			let lastControl = 0;
			let controllerInternals: Record<string, number> | undefined;
			const controller = $activeController;
			if (controller && MODE_CONFIGS[$gameMode].isAutomatic) {
				const result = controller.update({
					t: state.time,
					dt: DEFAULT_GAME_CONFIG.fixedDt,
					setpoint: SETPOINT,
					measurement: state.physics.y
				});
				lastControl = result.control;
				controllerInternals = result.internals;
				engine.setControl(lastControl);
			}

			// Advance simulation
			engine.tick(wallDt);

			const newState = engine.getState();
			score = newState.score;
			alive = newState.alive;

			// Record telemetry sample for this frame
			recorder.record({
				t: newState.time,
				y: newState.physics.y,
				v: newState.physics.v,
				setpoint: SETPOINT,
				error: SETPOINT - newState.physics.y,
				control: lastControl
			});

			// Update mini-chart and internals for overlay panel
			latestInternals = controllerInternals;
			chartSamples = recorder.getHistory(CHART_SAMPLES).map((s) => s.error);

			// Build overlay data for auto modes
			const overlayData: OverlayData | undefined = MODE_CONFIGS[$gameMode].isAutomatic
				? {
						setpoint: SETPOINT,
						error: SETPOINT - newState.physics.y,
						controlEffort: Math.min(Math.abs(lastControl) / MAX_CONTROL, 1),
						controllerInternals
					}
				: undefined;

			// Render
			if (scene) {
				scene.render(newState, newState.obstacles, overlayData);
			}

			// Handle game over
			if (!newState.alive) {
				gameRunning.set(false);
				animFrameId = null;

				// Persist high score
				const durationSec = runStartTime !== null ? newState.time - runStartTime : newState.time;
				const hs: HighScore = {
					id: `${Date.now()}-${newState.score}`,
					mode: $gameMode as HighScore['mode'],
					score: newState.score,
					durationSec,
					speedMultiplier,
					timestamp: new Date().toISOString(),
					controllerSnapshot: {}
				};
				saveHighScore(hs);
				refreshTopScores();
				return;
			}
		}

		animFrameId = requestAnimationFrame(loop);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.code === 'Space') {
			event.preventDefault();
			if ($gameMode === 'manual' && engine && $gameRunning) {
				engine.setControl(FLAP_FORCE);
				// Reset control back to zero after one tick by scheduling a clear
				// The engine will consume FLAP_FORCE on the next stepFixed call
				requestAnimationFrame(() => {
					if (engine) engine.setControl(0);
				});
			}
		}
	}

	function handleModeChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		gameMode.set(select.value as GameMode);
		refreshTopScores();
		// Restart with new mode if currently running
		if ($gameRunning) {
			stopGame();
			startGame();
		}
	}

	/**
	 * Build SVG polyline points for the error mini-chart.
	 * Y axis: error clamped to [-5, 5] world units, mapped to [chartH, 0].
	 */
	function buildChartPoints(errors: number[], width: number, height: number): string {
		if (errors.length < 2) return '';
		const xStep = width / (errors.length - 1);
		const halfH = height / 2;
		return errors
			.map((e, i) => {
				const x = i * xStep;
				const y = halfH - (Math.max(-5, Math.min(5, e)) / 5) * halfH;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeyDown);
		refreshTopScores();
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeyDown);
		stopGame();
		if (scene) {
			scene.dispose();
			scene = null;
		}
	});
</script>

<main class="flex min-h-screen flex-col items-center gap-4 p-4">
	<header class="flex w-full max-w-2xl items-center justify-between">
		<h1 class="text-2xl font-bold">Flappy Bird Control Lab</h1>
		<a href={resolve('/')} class="text-sm text-blue-600 hover:underline">Home</a>
	</header>

	<!-- Controls bar -->
	<div class="flex w-full max-w-2xl flex-wrap items-center gap-4 rounded-lg bg-gray-100 p-3">
		<label class="flex items-center gap-2">
			<span class="text-sm font-medium">Mode:</span>
			<select
				value={currentMode}
				onchange={handleModeChange}
				class="rounded border bg-white px-2 py-1 text-sm"
			>
				{#each Object.entries(MODE_CONFIGS) as [key, config] (key)}
					<option value={key}>{config.label}</option>
				{/each}
			</select>
		</label>

		<!-- Speed multiplier buttons (auto modes only) -->
		{#if currentMode !== 'manual'}
			<div class="flex items-center gap-1">
				<span class="text-sm font-medium">Speed:</span>
				{#each SPEED_OPTIONS as spd (spd)}
					<button
						onclick={() => {
							speedMultiplier = spd;
						}}
						class="rounded px-2 py-1 text-xs font-semibold {speedMultiplier === spd
							? 'bg-blue-600 text-white'
							: 'bg-white text-gray-700 hover:bg-gray-200'} border"
					>
						{spd}x
					</button>
				{/each}
			</div>
		{/if}

		{#if !running}
			<button
				onclick={startGame}
				class="rounded bg-green-600 px-4 py-1 text-sm font-semibold text-white hover:bg-green-700"
			>
				{!alive && score > 0 ? 'Restart' : 'Start'}
			</button>
		{:else}
			<button
				onclick={stopGame}
				class="rounded bg-red-600 px-4 py-1 text-sm font-semibold text-white hover:bg-red-700"
			>
				Stop
			</button>
		{/if}

		<span class="text-sm">Score: <strong>{score}</strong></span>
	</div>

	<!-- Preset selector (auto modes only) -->
	{#if currentMode !== 'manual' && modePresets.length > 0}
		<div class="w-full max-w-2xl rounded-lg border bg-white p-3">
			<p class="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
				Classroom Presets
			</p>
			<div class="flex flex-wrap gap-2">
				{#each modePresets as preset (preset.id)}
					<button
						onclick={() => applyPreset(preset)}
						title={preset.description}
						class="rounded border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
					>
						{preset.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Canvas -->
	<div class="relative w-full max-w-2xl">
		<canvas
			bind:this={canvas}
			width="800"
			height="400"
			class="w-full rounded-lg border bg-gray-900"
			style="aspect-ratio: 2/1;"
		></canvas>

		<!-- Pre-game prompt -->
		{#if !running && alive && score === 0}
			<div
				class="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/40"
			>
				<p class="text-lg font-semibold text-white">
					{currentMode === 'manual' ? 'Press Start, then Space to flap' : 'Press Start to begin'}
				</p>
			</div>
		{/if}

		<!-- Game-over overlay -->
		{#if !running && !alive}
			<div
				class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/60"
			>
				<p class="text-3xl font-bold text-white">Game Over</p>
				<p class="text-xl text-white">Final score: <strong>{score}</strong></p>
				<button
					onclick={startGame}
					class="rounded bg-green-600 px-6 py-2 font-semibold text-white hover:bg-green-700"
				>
					Play Again
				</button>
			</div>
		{/if}
	</div>

	<!-- Mode hint -->
	<p class="max-w-2xl text-center text-sm text-gray-500">
		{MODE_CONFIGS[currentMode].description}
		{#if currentMode === 'manual'}
			Press <kbd class="rounded border bg-gray-200 px-1 py-0.5 text-xs">Space</kbd> to flap.
		{/if}
		{#if currentMode !== 'manual' && speedMultiplier > 1}
			Running at <strong>{speedMultiplier}x</strong> speed.
		{/if}
	</p>

	<!-- Telemetry panel: error mini-chart + PID breakdown (auto modes, while running) -->
	{#if currentMode !== 'manual' && running}
		<div class="w-full max-w-2xl rounded-lg border bg-white p-3">
			<p class="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
				Error History (last {CHART_SAMPLES / 60}s)
			</p>
			<!-- SVG mini-chart: error over time -->
			<svg
				width="100%"
				height="60"
				viewBox="0 0 600 60"
				preserveAspectRatio="none"
				class="rounded border bg-gray-50"
				aria-label="Error history chart"
			>
				<!-- Zero line -->
				<line x1="0" y1="30" x2="600" y2="30" stroke="#d1d5db" stroke-width="1" />
				<!-- Error trace -->
				{#if chartSamples.length >= 2}
					<polyline
						points={buildChartPoints(chartSamples, 600, 60)}
						fill="none"
						stroke="#2563eb"
						stroke-width="1.5"
					/>
				{/if}
				<!-- ±1 unit guide lines -->
				<line x1="0" y1="24" x2="600" y2="24" stroke="#e5e7eb" stroke-width="0.5" />
				<line x1="0" y1="36" x2="600" y2="36" stroke="#e5e7eb" stroke-width="0.5" />
				<!-- Labels -->
				<text x="2" y="8" font-size="8" fill="#6b7280">+5</text>
				<text x="2" y="57" font-size="8" fill="#6b7280">−5</text>
				<text x="2" y="32" font-size="8" fill="#6b7280">0</text>
			</svg>

			<!-- PID component bars (pid mode only) -->
			{#if currentMode === 'auto-pid' && latestInternals}
				{@const p = latestInternals.proportional ?? 0}
				{@const i = latestInternals.integral ?? 0}
				{@const d = latestInternals.derivative ?? 0}
				{@const total = latestInternals.outputUnsaturated ?? 0}
				<div class="mt-3 space-y-1">
					<p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">PID Components</p>
					{#each [{ label: 'P', value: p, color: '#2563eb' }, { label: 'I', value: i, color: '#16a34a' }, { label: 'D', value: d, color: '#dc2626' }, { label: 'Total', value: total, color: '#7c3aed' }] as term (term.label)}
						<div class="flex items-center gap-2 text-xs">
							<span class="w-8 font-mono font-semibold" style="color:{term.color}"
								>{term.label}</span
							>
							<div class="relative h-3 flex-1 overflow-hidden rounded bg-gray-100">
								<!-- Positive bar -->
								{#if term.value > 0}
									<div
										class="absolute top-0 h-full rounded"
										style="left:50%;width:{Math.min(
											(term.value / MAX_CONTROL) * 50,
											50
										)}%;background:{term.color};opacity:0.75"
									></div>
								{:else if term.value < 0}
									<!-- Negative bar, extends left from centre -->
									<div
										class="absolute top-0 h-full rounded"
										style="right:50%;width:{Math.min(
											(-term.value / MAX_CONTROL) * 50,
											50
										)}%;background:{term.color};opacity:0.75"
									></div>
								{/if}
								<!-- Centre marker -->
								<div class="absolute top-0 left-1/2 h-full w-px bg-gray-300"></div>
							</div>
							<span class="w-14 text-right font-mono text-gray-600">{term.value.toFixed(2)}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- TF internals summary -->
			{#if currentMode === 'auto-tf' && latestInternals}
				<div class="mt-2 flex gap-4 text-xs text-gray-600">
					<span>Error: <strong>{(latestInternals.error ?? 0).toFixed(3)}</strong></span>
					<span>u_raw: <strong>{(latestInternals.u_raw ?? 0).toFixed(3)}</strong></span>
				</div>
			{/if}

			<!-- On-Off state indicator -->
			{#if currentMode === 'auto-onoff' && latestInternals}
				<div class="mt-2 flex items-center gap-3 text-xs">
					<span class="text-gray-600">Output state:</span>
					<span
						class="rounded px-2 py-0.5 font-bold {latestInternals.isHigh
							? 'bg-orange-100 text-orange-700'
							: 'bg-gray-200 text-gray-600'}"
					>
						{latestInternals.isHigh ? 'HIGH' : 'LOW'}
					</span>
					<span class="text-gray-500">Error: {(latestInternals.error ?? 0).toFixed(3)}</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Top-3 high scores for current mode -->
	{#if topScores.length > 0}
		<section class="w-full max-w-2xl">
			<h2 class="mb-2 text-sm font-semibold text-gray-700">
				Top scores — {MODE_CONFIGS[currentMode].label}
			</h2>
			<ol class="space-y-1">
				{#each topScores as hs, rank (hs.id)}
					<li class="flex items-center justify-between rounded bg-gray-100 px-3 py-1 text-sm">
						<span class="font-medium text-gray-600">#{rank + 1}</span>
						<span class="font-bold">{hs.score} pipes</span>
						<span class="text-gray-500">{hs.durationSec.toFixed(1)} s</span>
						{#if hs.speedMultiplier > 1}
							<span class="text-xs text-blue-600">{hs.speedMultiplier}x</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</main>
