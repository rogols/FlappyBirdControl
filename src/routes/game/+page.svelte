<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import { GameEngine, DEFAULT_GAME_CONFIG } from '$lib/game/engine';
	import { GameScene } from '$lib/game/scene-three';
	import type { OverlayData } from '$lib/game/scene-three';
	import { gameMode, gameRunning, activeController, actuatorMode } from '$lib/ui/stores';
	import { MODE_CONFIGS, ACTUATOR_CONFIGS } from '$lib/ui/mode-config';
	import { createControllerForMode } from '$lib/ui/controller-defaults';
	import { OnOffController } from '$lib/control/onoff-controller';
	import { PIDController } from '$lib/control/pid-controller';
	import { TFController } from '$lib/control/tf-controller';
	import type { GameMode } from '$lib/ui/stores';
	import { createActuatorModel, toPlantControl, controlEffortScale } from '$lib/game/actuator';
	import type { ActuatorMode, ActuatorModel } from '$lib/game/actuator';
	import { setpointAt, DEFAULT_SETPOINT_SCHEDULE } from '$lib/game/setpoint-schedule';
	import type { SetpointScheduleConfig } from '$lib/game/setpoint-schedule';
	import { TelemetryRecorder } from '$lib/telemetry/recorder';
	import { saveHighScore, getHighScores } from '$lib/persistence/highscore-store';
	import type { HighScore } from '$lib/persistence/highscore-store';
	import { getAllPresets } from '$lib/persistence/preset-store';
	import type { ControllerPreset } from '$lib/persistence/preset-store';
	import {
		computeMetrics,
		computeStepResponseMetrics,
		summarizeStepMetrics,
		saturationFraction
	} from '$lib/telemetry/metrics';
	import type { PerformanceMetrics, StepMetricsSummary } from '$lib/telemetry/metrics';
	import { saveRun, getRecentRuns, generateRunId } from '$lib/persistence/run-store';
	import type { RunSummary } from '$lib/persistence/run-store';
	import type { WorldState } from '$lib/game/state';

	/** Flap impulse force applied in manual mode (N) */
	const FLAP_FORCE = 25.0;
	/** Setpoint bounds for the arrow-key step commands (world units) */
	const SETPOINT_KEY_MIN = 2.0;
	const SETPOINT_KEY_MAX = 8.0;
	/** Speed multiplier options (simulation time / wall-clock time) */
	const SPEED_OPTIONS = [1, 2, 4, 8] as const;
	/** Disturbance force options (N) */
	const DISTURBANCE_OPTIONS = [-10, -5, 0, 5, 10] as const;
	/** Number of telemetry samples shown in the mini-chart */
	const CHART_SAMPLES = 180;
	/** Cap on simulation time consumed per animation frame (s of sim time) */
	const MAX_FRAME_SIM_TIME = 0.5;

	let canvas: HTMLCanvasElement | undefined = $state();
	let engine: GameEngine | null = null;
	let scene: GameScene | null = null;
	let animFrameId: number | null = null;
	let lastTimestamp: number | null = null;
	/** Sim time accumulated from frames but not yet consumed in fixed steps (s) */
	let frameAccumulator = 0;

	/** Telemetry ring buffer — 1200 samples ≈ 20 s at 60 Hz */
	const recorder = new TelemetryRecorder(1200);

	let score = $state(0);
	let alive = $state(true);
	let running = $derived($gameRunning);
	let currentMode = $derived($gameMode);
	let isAutomatic = $derived(MODE_CONFIGS[currentMode].isAutomatic);
	let currentActuator = $derived($actuatorMode);
	let speedMultiplier = $state<1 | 2 | 4 | 8>(1);
	/** Active disturbance force (N). Applied persistently until changed. */
	let disturbance = $state<-10 | -5 | 0 | 5 | 10>(0);
	/** Whether debug overlays (in-scene + telemetry panel) are visible. */
	let showOverlays = $state(true);

	/** Where the reference comes from: a constant level or the step schedule */
	let setpointSource = $state<'constant' | 'steps'>('steps');
	/** Level used by the constant source; adjustable with the arrow keys */
	let constantLevel = $state(DEFAULT_SETPOINT_SCHEDULE.baseLevel);
	/** Latest reference value, for display */
	let currentSetpoint = $state(DEFAULT_SETPOINT_SCHEDULE.baseLevel);

	/**
	 * Actuator model in effect for the current run. Manual mode always plays
	 * the authentic arcade actuator; the lab interpretation only applies to
	 * automatic controllers.
	 */
	let runActuator: ActuatorModel = createActuatorModel('arcade');

	/** Normalisation scale for effort bars — follows the run's actuator */
	let runEffortScale = $state(40);

	/** Whether the controller output is pinned at an actuator limit right now */
	let saturatedNow = $state(false);
	/** Percentage of the charted window spent at an actuator limit */
	let saturationPercent = $state(0);

	/** Latest controller internals for PID/TF overlay */
	let latestInternals: Record<string, number> | undefined = $state(undefined);

	/** Mini-chart data — last CHART_SAMPLES error values */
	let chartSamples: number[] = $state([]);

	/** Post-run metrics (shown in game-over overlay) */
	let lastMetrics: PerformanceMetrics | null = $state(null);

	/** Step-response summary of the finished run (null when no steps occurred) */
	let lastStepMetrics: StepMetricsSummary | null = $state(null);

	/** How the last run ended — selects the end-of-run overlay */
	let runEnded = $state<'crashed' | 'stopped' | null>(null);

	/** Recent runs (last 5) for the current mode */
	let recentRuns: RunSummary[] = $state([]);

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

	function refreshRecentRuns(): void {
		recentRuns = getRecentRuns(5, $gameMode as RunSummary['mode']);
	}

	/** Build the schedule config for the currently selected setpoint source. */
	function currentScheduleConfig(): SetpointScheduleConfig {
		if (setpointSource === 'steps') {
			return DEFAULT_SETPOINT_SCHEDULE;
		}
		return { ...DEFAULT_SETPOINT_SCHEDULE, kind: 'constant', baseLevel: constantLevel };
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

		// Presets carry arcade output limits — switch the actuator to match
		actuatorMode.set('arcade');
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

	async function startGame() {
		if (!canvas) return;

		// Manual mode always plays the authentic arcade actuator
		const effectiveActuatorMode: ActuatorMode = MODE_CONFIGS[$gameMode].isAutomatic
			? $actuatorMode
			: 'arcade';
		runActuator = createActuatorModel(effectiveActuatorMode);
		runEffortScale = controlEffortScale(runActuator);

		// Initialise or reset engine with the actuator's plant limits;
		// lab mode is a pure regulation experiment without pipes
		engine = new GameEngine({
			...DEFAULT_GAME_CONFIG,
			physicsParams: runActuator.physicsParams,
			spawnObstacles: ACTUATOR_CONFIGS[effectiveActuatorMode].spawnObstacles
		});
		engine.start();

		// Initialise or reset scene (await texture loading)
		if (!scene) {
			scene = new GameScene();
			await scene.init(canvas);
		}

		// Set up controller for current mode, clamped to the actuator's range
		const controller = createControllerForMode($gameMode, runActuator, $activeController);
		activeController.set(controller);
		if (controller) {
			controller.reset();
		}

		// Reset telemetry for the new run
		recorder.clear();
		chartSamples = [];
		latestInternals = undefined;
		lastMetrics = null;
		lastStepMetrics = null;
		runEnded = null;
		saturatedNow = false;
		saturationPercent = 0;
		currentSetpoint = setpointAt(currentScheduleConfig(), 0);
		runStartTime = null;

		// Apply current disturbance to the new engine
		engine.setDisturbance(disturbance);

		gameRunning.set(true);
		alive = true;
		score = 0;
		lastTimestamp = null;
		frameAccumulator = 0;

		refreshTopScores();
		refreshRecentRuns();

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

	/**
	 * Compute end-of-run metrics and persist the run summary.
	 * Called on game over (crash) and when the user stops an auto run —
	 * lab-mode regulation runs have no pipes, so Stop is their natural end.
	 */
	function finalizeRun(state: WorldState, ended: 'crashed' | 'stopped'): void {
		runEnded = ended;

		const durationSec = runStartTime !== null ? state.time - runStartTime : state.time;
		const timestamp = new Date().toISOString();
		const history = recorder.getHistory();

		const metrics = MODE_CONFIGS[$gameMode].isAutomatic ? computeMetrics(history) : null;
		lastMetrics = metrics;

		const stepSegments = MODE_CONFIGS[$gameMode].isAutomatic
			? computeStepResponseMetrics(history)
			: [];
		lastStepMetrics = stepSegments.length > 0 ? summarizeStepMetrics(stepSegments) : null;

		// High scores only make sense for completed (crashed) pipe runs
		if (ended === 'crashed') {
			const hs: HighScore = {
				id: `${Date.now()}-${state.score}`,
				mode: $gameMode as HighScore['mode'],
				score: state.score,
				durationSec,
				speedMultiplier,
				timestamp,
				controllerSnapshot: {}
			};
			saveHighScore(hs);
		}

		const run: RunSummary = {
			id: generateRunId(),
			mode: $gameMode as RunSummary['mode'],
			score: state.score,
			durationSec,
			speedMultiplier,
			timestamp,
			controllerSnapshot: {},
			disturbance,
			metrics,
			actuatorMode: runActuator.mode,
			stepMetrics: lastStepMetrics
		};
		saveRun(run);

		refreshTopScores();
		refreshRecentRuns();
	}

	/** User-initiated stop: end the run and report its metrics. */
	function handleStopClick(): void {
		const state = engine?.getState();
		stopGame();
		if (state && MODE_CONFIGS[$gameMode].isAutomatic && recorder.getHistory().length > 1) {
			finalizeRun(state, 'stopped');
		}
	}

	function loop(timestamp: number) {
		if (!$gameRunning) return;

		const rawWallDt = lastTimestamp !== null ? (timestamp - lastTimestamp) / 1000 : 0;
		lastTimestamp = timestamp;

		// Apply speed multiplier: advance simulation faster than wall-clock
		const wallDt = rawWallDt * speedMultiplier;

		if (engine && wallDt > 0) {
			// Track run start time for duration calculation
			if (runStartTime === null) {
				runStartTime = engine.getState().time;
			}

			const auto = MODE_CONFIGS[$gameMode].isAutomatic;
			const controller = $activeController;
			const dt = DEFAULT_GAME_CONFIG.fixedDt;

			// Advance the simulation in fixed steps and run the controller once
			// per step, so its sampling period is the declared 1/60 s regardless
			// of speed multiplier or display refresh rate. The accumulator is
			// capped so a stalled tab cannot trigger a catch-up spiral.
			frameAccumulator = Math.min(frameAccumulator + wallDt, MAX_FRAME_SIM_TIME);

			let lastControl = 0;
			let controllerInternals: Record<string, number> | undefined;
			let setpoint = currentSetpoint;
			let steppedThisFrame = false;

			while (frameAccumulator >= dt) {
				frameAccumulator -= dt;
				steppedThisFrame = true;

				const state = engine.getState();
				// Manual mode keeps a fixed mid-height reference for telemetry;
				// auto modes follow the selected schedule
				setpoint = auto
					? setpointAt(currentScheduleConfig(), state.time)
					: DEFAULT_SETPOINT_SCHEDULE.baseLevel;

				if (controller && auto) {
					const result = controller.update({
						t: state.time,
						dt,
						setpoint,
						measurement: state.physics.y
					});
					lastControl = result.control;
					controllerInternals = result.internals;
					engine.setControl(toPlantControl(runActuator, lastControl));
				}

				engine.tick(dt);

				const stepped = engine.getState();
				recorder.record({
					t: stepped.time,
					y: stepped.physics.y,
					v: stepped.physics.v,
					setpoint,
					error: setpoint - stepped.physics.y,
					control: lastControl
				});

				if (!stepped.alive) break;
			}

			const newState = engine.getState();
			score = newState.score;
			alive = newState.alive;

			if (steppedThisFrame) {
				currentSetpoint = setpoint;
				// Update mini-chart and internals for overlay panel
				latestInternals = controllerInternals;
				const recentSamples = recorder.getHistory(CHART_SAMPLES);
				chartSamples = recentSamples.map((s) => s.error);

				// Saturation monitoring: is the controller asking for more than
				// the actuator can deliver? (Only meaningful in auto modes.)
				if (auto) {
					const limitTolerance = 1e-6 * (runActuator.outputMax - runActuator.outputMin);
					saturatedNow =
						lastControl <= runActuator.outputMin + limitTolerance ||
						lastControl >= runActuator.outputMax - limitTolerance;
					saturationPercent =
						100 * saturationFraction(recentSamples, runActuator.outputMin, runActuator.outputMax);
				}
			}

			// Build overlay data for auto modes (suppressed when overlays are hidden)
			const overlayData: OverlayData | undefined =
				auto && showOverlays
					? {
							setpoint,
							error: setpoint - newState.physics.y,
							controlEffort: Math.min(Math.abs(lastControl) / controlEffortScale(runActuator), 1),
							controllerInternals
						}
					: undefined;

			// Render (pass rawWallDt for base scroll animation, unaffected by speed multiplier)
			if (scene) {
				scene.render(newState, newState.obstacles, overlayData, rawWallDt);
			}

			// Handle game over
			if (!newState.alive) {
				gameRunning.set(false);
				animFrameId = null;
				finalizeRun(newState, 'crashed');
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
			return;
		}

		// Arrow keys command manual setpoint steps in auto modes: each press is
		// a live step input whose response plays out on screen
		if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
			if (MODE_CONFIGS[$gameMode].isAutomatic && $gameRunning) {
				event.preventDefault();
				const delta = event.code === 'ArrowUp' ? 1 : -1;
				const base = setpointSource === 'steps' ? currentSetpoint : constantLevel;
				constantLevel = Math.min(
					SETPOINT_KEY_MAX,
					Math.max(SETPOINT_KEY_MIN, Math.round(base) + delta)
				);
				setpointSource = 'constant';
			}
		}
	}

	/** Switch actuator mode; restarts the run because the plant limits change. */
	function setActuatorMode(mode: ActuatorMode): void {
		if ($actuatorMode === mode) return;
		actuatorMode.set(mode);
		if ($gameRunning) {
			stopGame();
			startGame();
		}
	}

	/** Switch the setpoint source. Takes effect immediately — no restart needed. */
	function setSetpointSource(source: 'constant' | 'steps'): void {
		if (setpointSource === source) return;
		if (source === 'constant') {
			// Continue from the level the schedule is currently commanding
			constantLevel = Math.round(currentSetpoint * 2) / 2;
		}
		setpointSource = source;
	}

	function handleModeChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		gameMode.set(select.value as GameMode);
		refreshTopScores();
		refreshRecentRuns();
		// Restart with new mode if currently running
		if ($gameRunning) {
			stopGame();
			startGame();
		}
	}

	/** Update the disturbance in the live engine and record the new value. */
	function setDisturbanceLevel(d: -10 | -5 | 0 | 5 | 10): void {
		disturbance = d;
		if (engine) engine.setDisturbance(d);
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
		refreshRecentRuns();
		// onMount cleanup never runs during SSR, unlike onDestroy — the window
		// listener must be removed here or server rendering crashes
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	});

	onDestroy(() => {
		stopGame();
		if (scene) {
			scene.dispose();
			scene = null;
		}
	});
</script>

<main class="flex min-h-screen flex-col items-center gap-4 p-4">
	{#snippet stepMetricsRows(sm: StepMetricsSummary)}
		<span>Setpoint steps</span><span class="font-mono font-semibold">{sm.stepCount}</span>
		<span>Overshoot (mean)</span><span class="font-mono font-semibold" data-testid="overshoot-value"
			>{sm.meanOvershootPercent !== null ? sm.meanOvershootPercent.toFixed(1) + ' %' : '—'}</span
		>
		<span>Oscillations (mean)</span><span class="font-mono font-semibold"
			>{sm.meanOscillationCount !== null ? sm.meanOscillationCount.toFixed(1) : '—'}</span
		>
		<span>Step settle (mean)</span><span class="font-mono font-semibold"
			>{sm.meanSettleTimeSec !== null ? sm.meanSettleTimeSec.toFixed(2) + ' s' : '—'}</span
		>
		<span>Decay ratio (worst)</span><span class="font-mono font-semibold"
			>{sm.worstDecayRatio !== null ? sm.worstDecayRatio.toFixed(3) : '—'}</span
		>
	{/snippet}

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
			<!-- Actuator mode toggle -->
			<div class="flex items-center gap-1">
				<span class="text-sm font-medium">Actuator:</span>
				{#each Object.entries(ACTUATOR_CONFIGS) as [key, config] (key)}
					<button
						data-testid="actuator-{key}"
						onclick={() => setActuatorMode(key as ActuatorMode)}
						title={config.description}
						class="rounded border px-2 py-1 text-xs font-semibold {currentActuator === key
							? 'bg-indigo-600 text-white'
							: 'bg-white text-gray-700 hover:bg-gray-200'}"
					>
						{config.label}
					</button>
				{/each}
			</div>

			<!-- Setpoint source toggle -->
			<div class="flex items-center gap-1">
				<span class="text-sm font-medium">Setpoint:</span>
				{#each [{ key: 'constant', label: 'Constant' }, { key: 'steps', label: 'Steps' }] as source (source.key)}
					<button
						data-testid="setpoint-{source.key}"
						onclick={() => setSetpointSource(source.key as 'constant' | 'steps')}
						title={source.key === 'steps'
							? `Reference alternates ${DEFAULT_SETPOINT_SCHEDULE.levels[0]} / ${DEFAULT_SETPOINT_SCHEDULE.levels[1]} m every ${DEFAULT_SETPOINT_SCHEDULE.holdSec} s — each jump is a live step input`
							: 'Reference holds one altitude; nudge it with ↑/↓ while running'}
						class="rounded border px-2 py-1 text-xs font-semibold {setpointSource === source.key
							? 'bg-teal-600 text-white'
							: 'bg-white text-gray-700 hover:bg-gray-200'}"
					>
						{source.label}
					</button>
				{/each}
			</div>

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

			<!-- Disturbance force buttons -->
			<div class="flex items-center gap-1">
				<span class="text-sm font-medium">Wind:</span>
				{#each DISTURBANCE_OPTIONS as d (d)}
					<button
						onclick={() => setDisturbanceLevel(d)}
						title={d === 0 ? 'No wind' : d > 0 ? `+${d} N upward gust` : `${d} N downward gust`}
						class="rounded border px-2 py-1 text-xs font-semibold {disturbance === d
							? d > 0
								? 'bg-green-600 text-white'
								: d < 0
									? 'bg-orange-600 text-white'
									: 'bg-gray-600 text-white'
							: 'bg-white text-gray-700 hover:bg-gray-200'}"
					>
						{d > 0 ? `+${d}` : `${d}`}N
					</button>
				{/each}
			</div>
			<!-- Debug overlay toggle -->
			<button
				onclick={() => {
					showOverlays = !showOverlays;
				}}
				title={showOverlays ? 'Hide debug overlays' : 'Show debug overlays'}
				class="rounded border px-2 py-1 text-xs font-semibold {showOverlays
					? 'bg-purple-600 text-white'
					: 'bg-white text-gray-700 hover:bg-gray-200'}"
			>
				{showOverlays ? 'Overlays ON' : 'Overlays OFF'}
			</button>
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
				onclick={handleStopClick}
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
		{#if !running && runEnded === null}
			<div
				class="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/40"
			>
				<p class="text-lg font-semibold text-white">
					{currentMode === 'manual' ? 'Press Start, then Space to flap' : 'Press Start to begin'}
				</p>
			</div>
		{/if}

		<!-- Run-complete overlay (user pressed Stop during an auto run) -->
		{#if !running && alive && runEnded === 'stopped' && lastMetrics}
			<div
				data-testid="run-report"
				class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/70 px-6"
			>
				<p class="text-2xl font-bold text-white">Run Complete</p>
				<div class="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm text-white/90">
					<span>IAE</span><span class="font-mono font-semibold">{lastMetrics.iae.toFixed(2)}</span>
					<span>Peak error</span><span class="font-mono font-semibold"
						>{lastMetrics.peakError.toFixed(3)} m</span
					>
					{#if lastStepMetrics}
						{@render stepMetricsRows(lastStepMetrics)}
					{/if}
				</div>
				<button
					onclick={startGame}
					class="mt-2 rounded bg-green-600 px-6 py-2 font-semibold text-white hover:bg-green-700"
				>
					Run Again
				</button>
			</div>
		{/if}

		<!-- Game-over overlay -->
		{#if !running && !alive}
			<div
				class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/70 px-6"
			>
				<p class="text-3xl font-bold text-white">Game Over</p>
				<p class="text-xl text-white">Final score: <strong>{score}</strong></p>
				{#if lastMetrics}
					<div class="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm text-white/90">
						<span>IAE</span><span class="font-mono font-semibold">{lastMetrics.iae.toFixed(2)}</span
						>
						<span>ISE</span><span class="font-mono font-semibold">{lastMetrics.ise.toFixed(2)}</span
						>
						<span>ITAE</span><span class="font-mono font-semibold"
							>{lastMetrics.itae.toFixed(2)}</span
						>
						<span>Peak error</span><span class="font-mono font-semibold"
							>{lastMetrics.peakError.toFixed(3)} m</span
						>
						<span>Settle time</span><span class="font-mono font-semibold"
							>{lastMetrics.settleTimeSec !== null
								? lastMetrics.settleTimeSec.toFixed(2) + ' s'
								: '—'}</span
						>
						{#if lastStepMetrics}
							{@render stepMetricsRows(lastStepMetrics)}
						{/if}
					</div>
				{/if}
				<button
					onclick={startGame}
					class="mt-2 rounded bg-green-600 px-6 py-2 font-semibold text-white hover:bg-green-700"
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
		{#if isAutomatic}
			Use <kbd class="rounded border bg-gray-200 px-1 py-0.5 text-xs">↑</kbd>/<kbd
				class="rounded border bg-gray-200 px-1 py-0.5 text-xs">↓</kbd
			> to command setpoint steps while running.
		{/if}
		{#if currentMode !== 'manual' && speedMultiplier > 1}
			Running at <strong>{speedMultiplier}x</strong> speed.
		{/if}
		{#if currentMode !== 'manual' && disturbance !== 0}
			Wind disturbance: <strong>{disturbance > 0 ? '+' : ''}{disturbance} N</strong>
			({disturbance > 0 ? 'upward' : 'downward'}).
		{/if}
	</p>

	<!-- Theory bridge: why the arcade actuator deviates from the analysis views -->
	{#if isAutomatic && currentActuator === 'arcade'}
		<p
			data-testid="arcade-theory-hint"
			class="max-w-2xl rounded border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-800"
		>
			<strong>Arcade actuator:</strong> thrust is one-sided (0–40 N) and the controller itself must
			generate the hover force m·g — without integral action the bird settles below the setpoint,
			and braking an upward move relies on gravity alone. Switch the Actuator to
			<strong>Lab</strong> for symmetric thrust around hover: the loop then matches P(s) = 1/(m·s²) from
			the analysis views and shows textbook overshoot and oscillation.
		</p>
	{/if}
	{#if isAutomatic && currentActuator === 'lab'}
		<p
			data-testid="lab-mode-hint"
			class="max-w-2xl rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-center text-xs text-indigo-800"
		>
			<strong>Lab actuator:</strong> the controller commands a deviation u′ around hover (u = m·g +
			u′, u′ ∈ ±{controlEffortScale(createActuatorModel('lab')).toFixed(1)} N). No pipes — this is a pure
			regulation experiment scored by the step-response metrics. The same loop is analysed in the Analysis
			view.
		</p>
	{/if}

	<!-- Telemetry panel: error mini-chart + PID breakdown (auto modes, while running, overlays on) -->
	{#if currentMode !== 'manual' && running && showOverlays}
		<div class="w-full max-w-2xl rounded-lg border bg-white p-3">
			<div class="mb-1 flex items-center justify-between">
				<p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
					Error History (last {CHART_SAMPLES / 60}s)
				</p>
				<div class="flex items-center gap-2 text-xs">
					<span class="font-mono text-gray-600" data-testid="setpoint-readout"
						>SP: {currentSetpoint.toFixed(1)} m</span
					>
					{#if saturatedNow}
						<span
							data-testid="saturation-badge"
							class="rounded bg-red-100 px-2 py-0.5 font-bold text-red-700"
							title="The controller is asking for more force than the actuator can deliver — the loop is outside the linear regime the analysis views assume"
						>
							SATURATED
						</span>
					{/if}
					<span
						class="font-mono {saturationPercent > 20 ? 'text-red-600' : 'text-gray-500'}"
						title="Share of the charted window spent at an actuator limit"
						data-testid="saturation-percent">sat {saturationPercent.toFixed(0)}%</span
					>
				</div>
			</div>
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
											(term.value / runEffortScale) * 50,
											50
										)}%;background:{term.color};opacity:0.75"
									></div>
								{:else if term.value < 0}
									<!-- Negative bar, extends left from centre -->
									<div
										class="absolute top-0 h-full rounded"
										style="right:50%;width:{Math.min(
											(-term.value / runEffortScale) * 50,
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

	<!-- Recent runs with performance metrics (auto modes only) -->
	{#if currentMode !== 'manual' && recentRuns.length > 0}
		<section class="w-full max-w-2xl">
			<h2 class="mb-2 text-sm font-semibold text-gray-700">
				Recent runs — {MODE_CONFIGS[currentMode].label}
			</h2>
			<div class="overflow-x-auto rounded border">
				<table class="w-full text-xs">
					<thead class="bg-gray-100">
						<tr>
							<th class="px-2 py-1 text-left font-semibold text-gray-600">Score</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">IAE</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">ISE</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">Peak err</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">Settle</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">OS%</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">Act</th>
							<th class="px-2 py-1 text-right font-semibold text-gray-600">Wind</th>
						</tr>
					</thead>
					<tbody>
						{#each recentRuns as run (run.id)}
							<tr class="border-t odd:bg-white even:bg-gray-50">
								<td class="px-2 py-1 font-bold">{run.score}</td>
								<td class="px-2 py-1 text-right font-mono"
									>{run.metrics ? run.metrics.iae.toFixed(1) : '—'}</td
								>
								<td class="px-2 py-1 text-right font-mono"
									>{run.metrics ? run.metrics.ise.toFixed(1) : '—'}</td
								>
								<td class="px-2 py-1 text-right font-mono"
									>{run.metrics ? run.metrics.peakError.toFixed(2) : '—'}</td
								>
								<td class="px-2 py-1 text-right font-mono"
									>{run.metrics?.settleTimeSec != null
										? run.metrics.settleTimeSec.toFixed(1) + 's'
										: '—'}</td
								>
								<td class="px-2 py-1 text-right font-mono"
									>{run.stepMetrics?.meanOvershootPercent != null
										? run.stepMetrics.meanOvershootPercent.toFixed(0)
										: '—'}</td
								>
								<td class="px-2 py-1 text-right font-mono text-gray-500"
									>{run.actuatorMode === 'lab' ? 'Lab' : 'Arc'}</td
								>
								<td
									class="px-2 py-1 text-right font-mono {run.disturbance !== 0
										? 'text-orange-600'
										: 'text-gray-400'}"
									>{run.disturbance !== 0
										? (run.disturbance > 0 ? '+' : '') + run.disturbance + 'N'
										: '0'}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</main>
