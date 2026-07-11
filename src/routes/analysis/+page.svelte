<script lang="ts">
	import { resolve } from '$app/paths';
	import { activeController, gameMode, actuatorMode } from '$lib/ui/stores';
	import { DEFAULT_PHYSICS_PARAMS, createActuatorModel } from '$lib/analysis/model';
	import type { ActuatorMode } from '$lib/analysis/model';
	import { getModelDescription } from '$lib/analysis/model';
	import { computeStepResponse } from '$lib/analysis/step-response';
	import { simulateClosedLoop, simulateLinearClosedLoop } from '$lib/analysis/closed-loop';
	import type { ClosedLoopPoint } from '$lib/analysis/closed-loop';
	import { computeStepResponseMetrics } from '$lib/telemetry/metrics';
	import type { StepSegmentMetrics } from '$lib/telemetry/metrics';
	import type { Controller } from '$lib/control/interfaces';
	import { GAME_ONOFF_LEVELS } from '$lib/ui/controller-defaults';
	import {
		computePlantBode,
		computeOpenLoopBode,
		computeClosedLoopBode,
		logspace
	} from '$lib/analysis/bode';
	import { computePlantPoleZero, computeClosedLoopPoleZero } from '$lib/analysis/pole-zero';
	import { OnOffController } from '$lib/control/onoff-controller';
	import { PIDController } from '$lib/control/pid-controller';
	import { TFController, DEFAULT_TF_PARAMS } from '$lib/control/tf-controller';
	import type { OnOffParams } from '$lib/control/onoff-controller';
	import type { PIDParams } from '$lib/control/pid-controller';
	import { DEFAULT_ONOFF_PARAMS } from '$lib/control/onoff-controller';
	import { DEFAULT_PID_PARAMS } from '$lib/control/pid-controller';
	import { tustinDiscretize, formatPolyZ } from '$lib/control/discretization';
	import { findRoots } from '$lib/analysis/pole-zero';
	import type { Complex } from '$lib/analysis/pole-zero';

	// ── Physics & model ──────────────────────────────────────────────────────
	const physicsParams = DEFAULT_PHYSICS_PARAMS;
	const model = getModelDescription(physicsParams);

	// ── Tunable controller params ─────────────────────────────────────────────
	let onoffParams: OnOffParams = $state({ ...DEFAULT_ONOFF_PARAMS, highOutput: 30, lowOutput: 0 });
	let pidParams: PIDParams = $state({ ...DEFAULT_PID_PARAMS, kp: 8, ki: 1, kd: 2 });

	// ── Step response config ──────────────────────────────────────────────────
	let stepAmplitude = $state(physicsParams.uMax / 2);
	let stepDuration = $state(5);

	// ── Bode config ───────────────────────────────────────────────────────────
	const FREQ_MIN = 0.01;
	const FREQ_MAX = 100;
	const BODE_POINTS = 200;

	// ── Derived computations ──────────────────────────────────────────────────
	const frequencies = $derived(logspace(FREQ_MIN, FREQ_MAX, BODE_POINTS));

	const stepResponse = $derived(
		computeStepResponse({
			stepAmplitude,
			durationSec: stepDuration,
			dt: 1 / 60,
			params: physicsParams
		})
	);

	const plantBode = $derived(computePlantBode(frequencies, physicsParams));
	const openLoopBode = $derived(computeOpenLoopBode(frequencies, physicsParams, pidParams));
	const closedLoopBode = $derived(computeClosedLoopBode(frequencies, physicsParams, pidParams));

	const plantPZ = $derived(computePlantPoleZero(physicsParams));
	const closedLoopPZ = $derived(computeClosedLoopPoleZero(physicsParams, pidParams));

	// ── Closed-loop step response (theory bridge) ─────────────────────────────
	/** Which controller drives the closed-loop simulation */
	let clSource = $state<'pid' | 'onoff' | 'tf'>('pid');
	/** Actuator interpretation for the nonlinear (game-truth) trace */
	let clActuatorMode = $state<ActuatorMode>($actuatorMode);
	/** Signed setpoint step (world units) */
	let clStepSize = $state(1);
	const CL_STEP_OPTIONS = [-2, -1, -0.5, 0.5, 1, 2] as const;
	const CL_STEP_TIME = 1;
	const CL_DURATION = 8;
	const CL_INITIAL = 5;
	const CL_DT = 1 / 60;
	/**
	 * Regulation time before the displayed window (s): lets the arcade loop
	 * converge from its start-up free fall so the trace shows the step
	 * response, not the start-up transient. The arcade loop's slowest pole has
	 * a ~8 s time constant, hence the long warm-up.
	 */
	const CL_WARMUP = 30;
	/** Unbounded output limits for the pure-linear reference controller */
	const CL_UNBOUNDED = 1e9;

	function buildClController(clamped: boolean): Controller | null {
		const act = createActuatorModel(clActuatorMode);
		const outputMin = clamped ? act.outputMin : -CL_UNBOUNDED;
		const outputMax = clamped ? act.outputMax : CL_UNBOUNDED;
		switch (clSource) {
			case 'pid':
				return new PIDController({ ...pidParams, outputMin, outputMax });
			case 'onoff': {
				// Relay control is inherently nonlinear — only the game-truth trace exists
				if (!clamped) return null;
				const levels = clActuatorMode === 'lab' ? GAME_ONOFF_LEVELS.lab : GAME_ONOFF_LEVELS.arcade;
				return new OnOffController({
					...levels,
					threshold: onoffParams.threshold,
					hysteresis: onoffParams.hysteresis
				});
			}
			case 'tf':
				if (!tfInfo.ok) return null;
				return new TFController({
					numerator: tfNum,
					denominator: tfDen,
					dt: CL_DT,
					outputMin,
					outputMax
				});
		}
	}

	const clNonlinear = $derived(
		((): ClosedLoopPoint[] => {
			const controller = buildClController(true);
			if (!controller) return [];
			return simulateClosedLoop({
				controller,
				actuatorMode: clActuatorMode,
				stepTime: CL_STEP_TIME,
				initialSetpoint: CL_INITIAL,
				finalSetpoint: CL_INITIAL + clStepSize,
				durationSec: CL_DURATION,
				dt: CL_DT,
				warmupSec: CL_WARMUP
			});
		})()
	);

	const clLinear = $derived(
		((): ClosedLoopPoint[] => {
			const controller = buildClController(false);
			if (!controller) return [];
			return simulateLinearClosedLoop({
				controller,
				stepTime: CL_STEP_TIME,
				initialSetpoint: CL_INITIAL,
				finalSetpoint: CL_INITIAL + clStepSize,
				durationSec: CL_DURATION,
				dt: CL_DT
			});
		})()
	);

	function clSegmentMetrics(points: ClosedLoopPoint[]): StepSegmentMetrics | null {
		if (points.length === 0) return null;
		const segments = computeStepResponseMetrics(
			points.map((p) => ({
				t: p.t,
				y: p.y,
				v: p.v,
				setpoint: p.setpoint,
				error: p.setpoint - p.y,
				control: p.u
			}))
		);
		return segments.length > 0 ? segments[0] : null;
	}

	const clNonlinearMetrics = $derived(clSegmentMetrics(clNonlinear));
	const clLinearMetrics = $derived(clSegmentMetrics(clLinear));

	const clYRange = $derived(
		(() => {
			const ys = [
				...clNonlinear.map((p) => p.y),
				...clLinear.map((p) => p.y),
				CL_INITIAL,
				CL_INITIAL + clStepSize
			];
			const lo = Math.min(...ys) - 0.4;
			const hi = Math.max(...ys) + 0.4;
			return { lo, hi };
		})()
	);

	function clTracePath(points: ClosedLoopPoint[], value: (p: ClosedLoopPoint) => number): string {
		return pointsToPath(
			points.map((p) => ({
				x: mapX(p.t, 0, CL_DURATION),
				y: mapY(value(p), clYRange.lo, clYRange.hi)
			}))
		);
	}

	const clNonlinearPath = $derived(clTracePath(clNonlinear, (p) => p.y));
	const clLinearPath = $derived(clTracePath(clLinear, (p) => p.y));
	const clSetpointPath = $derived(clTracePath(clNonlinear, (p) => p.setpoint));

	// ── Apply to Auto Mode ────────────────────────────────────────────────────
	let applyFeedback = $state('');

	function applyOnOff() {
		const controller = new OnOffController({ ...onoffParams });
		controller.reset();
		activeController.set(controller);
		gameMode.set('auto-onoff');
		applyFeedback = 'On-Off controller applied to Auto Mode.';
		setTimeout(() => (applyFeedback = ''), 3000);
	}

	function applyPID() {
		const controller = new PIDController({ ...pidParams });
		controller.reset();
		activeController.set(controller);
		gameMode.set('auto-pid');
		applyFeedback = 'PID controller applied to Auto Mode.';
		setTimeout(() => (applyFeedback = ''), 3000);
	}

	// ── G(s) Transfer Function tuning ─────────────────────────────────────────
	let tfNumStr = $state(DEFAULT_TF_PARAMS.numerator.join(' '));
	let tfDenStr = $state(DEFAULT_TF_PARAMS.denominator.join(' '));
	let tfOutputMin = $state(DEFAULT_TF_PARAMS.outputMin);
	let tfOutputMax = $state(DEFAULT_TF_PARAMS.outputMax);

	function parseCoeffs(s: string): number[] {
		return s
			.split(/[\s,]+/)
			.map(parseFloat)
			.filter((x) => !isNaN(x));
	}

	const tfNum = $derived(parseCoeffs(tfNumStr));
	const tfDen = $derived(parseCoeffs(tfDenStr));

	interface TFInfo {
		ok: boolean;
		error?: string;
		discNum?: number[];
		discDen?: number[];
		poles?: Complex[];
		stable?: boolean;
	}

	const tfInfo = $derived(
		((): TFInfo => {
			const num = tfNum;
			const den = tfDen;
			if (num.length === 0 || den.length === 0) return { ok: false, error: 'Enter coefficients' };
			if (num.length - 1 > den.length - 1)
				return { ok: false, error: 'Improper: deg(N) > deg(D). Add a filter pole to denominator.' };
			try {
				const { numerator: dn, denominator: dd } = tustinDiscretize(num, den, DEFAULT_TF_PARAMS.dt);
				const a0 = dd[0];
				const normDen = dd.map((c) => c / a0);
				const normNum = dn.map((c) => c / a0);
				const poles = findRoots(normDen);
				const stable = poles.every((p) => Math.sqrt(p.re * p.re + p.im * p.im) < 1.0);
				return { ok: true, discNum: normNum, discDen: normDen, poles, stable };
			} catch (e) {
				return { ok: false, error: e instanceof Error ? e.message : String(e) };
			}
		})()
	);

	function applyTF() {
		if (!tfInfo.ok) return;
		const controller = new TFController({
			numerator: tfNum,
			denominator: tfDen,
			dt: DEFAULT_TF_PARAMS.dt,
			outputMin: tfOutputMin,
			outputMax: tfOutputMax
		});
		controller.reset();
		activeController.set(controller);
		gameMode.set('auto-tf');
		applyFeedback = 'Transfer function controller applied to Auto Mode.';
		setTimeout(() => (applyFeedback = ''), 3000);
	}

	// ── SVG chart helpers ─────────────────────────────────────────────────────
	const SVG_W = 400;
	const SVG_H = 180;
	const PAD = { top: 10, right: 20, bottom: 30, left: 50 };
	const CHART_W = SVG_W - PAD.left - PAD.right;
	const CHART_H = SVG_H - PAD.top - PAD.bottom;

	function mapX(val: number, min: number, max: number): number {
		return PAD.left + ((val - min) / (max - min)) * CHART_W;
	}
	function mapY(val: number, min: number, max: number): number {
		return PAD.top + CHART_H - ((val - min) / (max - min)) * CHART_H;
	}

	function pointsToPath(pts: { x: number; y: number }[]): string {
		if (pts.length === 0) return '';
		return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
	}

	// Step response chart
	const SR_Y_MIN = physicsParams.yMin;
	const SR_Y_MAX = physicsParams.yMax;

	const stepPath = $derived(
		pointsToPath(
			stepResponse.map((pt) => ({
				x: mapX(pt.t, 0, stepDuration),
				y: mapY(pt.y, SR_Y_MIN, SR_Y_MAX)
			}))
		)
	);

	// Bode magnitude chart
	const MAG_MIN = -80;
	const MAG_MAX = 40;

	function bodeX(omega: number): number {
		return mapX(Math.log10(omega), Math.log10(FREQ_MIN), Math.log10(FREQ_MAX));
	}

	const plantMagPath = $derived(
		pointsToPath(
			plantBode
				.filter((p) => isFinite(p.magnitudeDb))
				.map((p) => ({ x: bodeX(p.freq), y: mapY(p.magnitudeDb, MAG_MIN, MAG_MAX) }))
		)
	);

	const olMagPath = $derived(
		pointsToPath(
			openLoopBode
				.filter((p) => isFinite(p.magnitudeDb))
				.map((p) => ({ x: bodeX(p.freq), y: mapY(p.magnitudeDb, MAG_MIN, MAG_MAX) }))
		)
	);

	const clMagPath = $derived(
		pointsToPath(
			closedLoopBode
				.filter((p) => isFinite(p.magnitudeDb))
				.map((p) => ({ x: bodeX(p.freq), y: mapY(p.magnitudeDb, MAG_MIN, MAG_MAX) }))
		)
	);

	// Bode phase chart
	const PH_MIN = -270;
	const PH_MAX = 90;

	const plantPhasePath = $derived(
		pointsToPath(
			plantBode
				.filter((p) => isFinite(p.phaseDeg))
				.map((p) => ({ x: bodeX(p.freq), y: mapY(p.phaseDeg, PH_MIN, PH_MAX) }))
		)
	);

	const olPhasePath = $derived(
		pointsToPath(
			openLoopBode
				.filter((p) => isFinite(p.phaseDeg))
				.map((p) => ({ x: bodeX(p.freq), y: mapY(p.phaseDeg, PH_MIN, PH_MAX) }))
		)
	);

	const clPhasePath = $derived(
		pointsToPath(
			closedLoopBode
				.filter((p) => isFinite(p.phaseDeg))
				.map((p) => ({ x: bodeX(p.freq), y: mapY(p.phaseDeg, PH_MIN, PH_MAX) }))
		)
	);

	// Pole-zero chart
	const PZ_SVG_W = 300;
	const PZ_SVG_H = 300;
	const PZ_PAD = 40;
	const PZ_CHART_W = PZ_SVG_W - 2 * PZ_PAD;
	const PZ_CHART_H = PZ_SVG_H - 2 * PZ_PAD;

	// Determine scale from closed-loop poles
	const pzScale = $derived(
		(() => {
			const allRe = [
				...closedLoopPZ.poles.map((p) => Math.abs(p.re)),
				...closedLoopPZ.zeros.map((z) => Math.abs(z.re)),
				1
			];
			const allIm = [
				...closedLoopPZ.poles.map((p) => Math.abs(p.im)),
				...closedLoopPZ.zeros.map((z) => Math.abs(z.im)),
				1
			];
			return Math.max(...allRe, ...allIm) * 1.4 || 1;
		})()
	);

	function pzMapX(re: number): number {
		return PZ_PAD + PZ_CHART_W / 2 + (re / pzScale) * (PZ_CHART_W / 2);
	}
	function pzMapY(im: number): number {
		return PZ_PAD + PZ_CHART_H / 2 - (im / pzScale) * (PZ_CHART_H / 2);
	}

	// Tick labels for bode x-axis (log scale)
	const bodeXTicks = [0.01, 0.1, 1, 10, 100];

	// Bode y-axis ticks (magnitude)
	const magYTicks = [-80, -60, -40, -20, 0, 20, 40];
	// Bode y-axis ticks (phase)
	const phaseYTicks = [-270, -180, -90, 0, 90];
</script>

<main class="flex min-h-screen flex-col gap-6 p-6 font-mono text-sm">
	<header class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Analysis &amp; Design View</h1>
		<div class="flex gap-3">
			<a href={resolve('/game')} class="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">
				Game
			</a>
			<a href={resolve('/')} class="rounded bg-gray-200 px-3 py-1 text-gray-800 hover:bg-gray-300">
				Home
			</a>
		</div>
	</header>

	<!-- ── ODE Model Display ─────────────────────────────────────────────── -->
	<section class="rounded-lg border bg-gray-50 p-4">
		<h2 class="mb-2 font-semibold">Plant Model — {model.title}</h2>
		<div class="space-y-1 font-mono text-base">
			<p class="text-gray-700">{model.ode.positionEq}</p>
			<p class="text-gray-700">{model.ode.momentumEq}</p>
		</div>
		<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-3">
			<span>m = {physicsParams.mass} kg</span>
			<span>g = {physicsParams.gravity} m/s²</span>
			<span>c_d = {physicsParams.dragCoeff} kg/m</span>
			<span>u ∈ [{physicsParams.uMin}, {physicsParams.uMax}] N</span>
			<span>y ∈ [{physicsParams.yMin}, {physicsParams.yMax}] m</span>
			<span>u_eq = {model.equilibriumControl.toFixed(2)} N</span>
		</div>
		<p class="mt-2 text-xs text-gray-500">
			Linearised plant (at v₀=0): P(s) = 1/(m·s²) — double integrator
		</p>
	</section>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- ── Step Response ───────────────────────────────────────────────── -->
		<section class="rounded-lg border p-4">
			<h2 class="mb-3 font-semibold">Step Response (open-loop plant)</h2>
			<div class="mb-2 flex flex-wrap gap-4 text-xs">
				<label class="flex items-center gap-1">
					u =
					<input
						type="range"
						min="0"
						max={physicsParams.uMax}
						step="1"
						bind:value={stepAmplitude}
						class="w-24"
					/>
					<span class="w-8 text-right">{stepAmplitude} N</span>
				</label>
				<label class="flex items-center gap-1">
					t =
					<input type="range" min="1" max="10" step="0.5" bind:value={stepDuration} class="w-16" />
					<span class="w-8 text-right">{stepDuration} s</span>
				</label>
			</div>
			<svg viewBox="0 0 {SVG_W} {SVG_H}" class="w-full">
				<!-- Axes -->
				<line
					x1={PAD.left}
					y1={PAD.top}
					x2={PAD.left}
					y2={PAD.top + CHART_H}
					stroke="#9ca3af"
					stroke-width="1"
				/>
				<line
					x1={PAD.left}
					y1={PAD.top + CHART_H}
					x2={PAD.left + CHART_W}
					y2={PAD.top + CHART_H}
					stroke="#9ca3af"
					stroke-width="1"
				/>
				<!-- Y grid lines -->
				{#each [0, 2.5, 5, 7.5, 10] as yVal (yVal)}
					{@const yPx = mapY(yVal, SR_Y_MIN, SR_Y_MAX)}
					<line
						x1={PAD.left}
						y1={yPx}
						x2={PAD.left + CHART_W}
						y2={yPx}
						stroke="#e5e7eb"
						stroke-width="1"
					/>
					<text x={PAD.left - 4} y={yPx + 4} text-anchor="end" font-size="9" fill="#6b7280"
						>{yVal}</text
					>
				{/each}
				<!-- X ticks -->
				{#each [0, 1, 2, 3, 4, 5].filter((t) => t <= stepDuration) as tVal (tVal)}
					{@const xPx = mapX(tVal, 0, stepDuration)}
					<text x={xPx} y={PAD.top + CHART_H + 14} text-anchor="middle" font-size="9" fill="#6b7280"
						>{tVal}</text
					>
				{/each}
				<!-- Setpoint line -->
				<line
					x1={PAD.left}
					y1={mapY(5, SR_Y_MIN, SR_Y_MAX)}
					x2={PAD.left + CHART_W}
					y2={mapY(5, SR_Y_MIN, SR_Y_MAX)}
					stroke="#ef4444"
					stroke-width="1"
					stroke-dasharray="4 3"
				/>
				<!-- Step response curve -->
				{#if stepPath}
					<path d={stepPath} fill="none" stroke="#3b82f6" stroke-width="1.5" />
				{/if}
				<!-- Axis labels -->
				<text
					x={PAD.left + CHART_W / 2}
					y={SVG_H - 2}
					text-anchor="middle"
					font-size="9"
					fill="#6b7280">Time (s)</text
				>
				<text
					x={10}
					y={PAD.top + CHART_H / 2}
					text-anchor="middle"
					font-size="9"
					fill="#6b7280"
					transform="rotate(-90, 10, {PAD.top + CHART_H / 2})">Position (m)</text
				>
			</svg>
			<div class="mt-1 flex gap-4 text-xs">
				<span class="flex items-center gap-1">
					<span class="inline-block h-0.5 w-4 bg-blue-500"></span> y(t)
				</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-0.5 w-4 border-t-2 border-dashed border-red-400"></span>
					setpoint 5 m
				</span>
			</div>
		</section>

		<!-- ── Pole-Zero Map ───────────────────────────────────────────────── -->
		<section class="rounded-lg border p-4">
			<h2 class="mb-3 font-semibold">Pole-Zero Map</h2>
			<svg viewBox="0 0 {PZ_SVG_W} {PZ_SVG_H}" class="mx-auto w-64">
				<!-- Axes -->
				<line
					x1={PZ_PAD}
					y1={PZ_PAD + PZ_CHART_H / 2}
					x2={PZ_PAD + PZ_CHART_W}
					y2={PZ_PAD + PZ_CHART_H / 2}
					stroke="#9ca3af"
					stroke-width="1"
				/>
				<line
					x1={PZ_PAD + PZ_CHART_W / 2}
					y1={PZ_PAD}
					x2={PZ_PAD + PZ_CHART_W / 2}
					y2={PZ_PAD + PZ_CHART_H}
					stroke="#9ca3af"
					stroke-width="1"
				/>
				<!-- Left-half-plane stability boundary -->
				<line
					x1={PZ_PAD + PZ_CHART_W / 2}
					y1={PZ_PAD}
					x2={PZ_PAD + PZ_CHART_W / 2}
					y2={PZ_PAD + PZ_CHART_H}
					stroke="#fca5a5"
					stroke-width="1"
					stroke-dasharray="4 3"
				/>
				<!-- Axis labels -->
				<text
					x={PZ_PAD + PZ_CHART_W / 2}
					y={PZ_SVG_H - 4}
					text-anchor="middle"
					font-size="9"
					fill="#6b7280">Re(s)</text
				>
				<text
					x={8}
					y={PZ_PAD + PZ_CHART_H / 2}
					text-anchor="middle"
					font-size="9"
					fill="#6b7280"
					transform="rotate(-90, 8, {PZ_PAD + PZ_CHART_H / 2})">Im(s)</text
				>
				<!-- Plant poles (grey ×) -->
				{#each plantPZ.poles as pole, i (i)}
					{@const px = pzMapX(pole.re)}
					{@const py = pzMapY(pole.im)}
					<text x={px} y={py + 5} text-anchor="middle" font-size="14" fill="#9ca3af">×</text>
				{/each}
				<!-- Closed-loop poles (blue ×) -->
				{#each closedLoopPZ.poles as pole, i (i)}
					{@const px = pzMapX(pole.re)}
					{@const py = pzMapY(pole.im)}
					<text x={px} y={py + 5} text-anchor="middle" font-size="14" fill="#3b82f6">×</text>
				{/each}
				<!-- Closed-loop zeros (blue ○) -->
				{#each closedLoopPZ.zeros as zero, i (i)}
					{@const zx = pzMapX(zero.re)}
					{@const zy = pzMapY(zero.im)}
					<circle cx={zx} cy={zy} r="5" fill="none" stroke="#10b981" stroke-width="1.5" />
				{/each}
			</svg>
			<div class="mt-2 flex flex-wrap gap-3 text-xs">
				<span class="flex items-center gap-1">
					<span class="font-bold text-gray-400">×</span> Plant poles (s=0,0)
				</span>
				<span class="flex items-center gap-1">
					<span class="font-bold text-blue-500">×</span> CL poles
				</span>
				<span class="flex items-center gap-1">
					<span class="font-bold text-emerald-500">○</span> CL zeros
				</span>
			</div>
			<div class="mt-2 space-y-0.5 text-xs text-gray-600">
				{#each closedLoopPZ.poles as p, i (i)}
					<p>CL pole {i + 1}: {p.re.toFixed(3)} {p.im >= 0 ? '+' : ''}{p.im.toFixed(3)}j</p>
				{/each}
			</div>
		</section>
	</div>

	<!-- ── Closed-Loop Step Response (theory bridge) ─────────────────────────── -->
	<section class="rounded-lg border p-4" data-testid="closed-loop-section">
		<h2 class="mb-1 font-semibold">Closed-Loop Step Response — theory vs game</h2>
		<p class="mb-3 text-xs text-gray-500">
			The <span class="font-semibold text-blue-600">game-truth</span> trace runs your controller
			through the exact game plant (gravity, drag, actuator saturation). The
			<span class="font-semibold text-amber-600">textbook</span> trace runs the same controller against
			the linearised model P(s) = 1/(m·s²) that the Bode and pole-zero views analyse.
		</p>

		<div class="mb-3 flex flex-wrap items-center gap-4 text-xs">
			<label class="flex items-center gap-1">
				Controller:
				<select bind:value={clSource} class="rounded border bg-white px-2 py-1">
					<option value="pid">PID (gains above)</option>
					<option value="onoff">On-Off</option>
					<option value="tf">Transfer function C(s)</option>
				</select>
			</label>
			<div class="flex items-center gap-1">
				<span class="font-medium">Actuator:</span>
				{#each ['arcade', 'lab'] as const as mode (mode)}
					<button
						data-testid="cl-actuator-{mode}"
						onclick={() => (clActuatorMode = mode)}
						class="rounded border px-2 py-1 font-semibold {clActuatorMode === mode
							? 'bg-indigo-600 text-white'
							: 'bg-white text-gray-700 hover:bg-gray-200'}"
					>
						{mode === 'arcade' ? 'Arcade' : 'Lab'}
					</button>
				{/each}
			</div>
			<label class="flex items-center gap-1">
				Step:
				<select bind:value={clStepSize} class="rounded border bg-white px-2 py-1">
					{#each CL_STEP_OPTIONS as s (s)}
						<option value={s}>{s > 0 ? '+' : ''}{s} m</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="grid gap-4 lg:grid-cols-2">
			<svg viewBox="0 0 {SVG_W} {SVG_H}" class="w-full">
				<line
					x1={PAD.left}
					y1={PAD.top}
					x2={PAD.left}
					y2={PAD.top + CHART_H}
					stroke="#9ca3af"
					stroke-width="1"
				/>
				<line
					x1={PAD.left}
					y1={PAD.top + CHART_H}
					x2={PAD.left + CHART_W}
					y2={PAD.top + CHART_H}
					stroke="#9ca3af"
					stroke-width="1"
				/>
				{#each [0, 2, 4, 6, 8] as tVal (tVal)}
					<text
						x={mapX(tVal, 0, CL_DURATION)}
						y={PAD.top + CHART_H + 14}
						text-anchor="middle"
						font-size="9"
						fill="#6b7280">{tVal}</text
					>
				{/each}
				{#if clSetpointPath}
					<path
						d={clSetpointPath}
						fill="none"
						stroke="#ef4444"
						stroke-width="1"
						stroke-dasharray="4 3"
					/>
				{/if}
				{#if clLinearPath}
					<path
						data-testid="cl-linear-path"
						d={clLinearPath}
						fill="none"
						stroke="#f59e0b"
						stroke-width="1.5"
						stroke-dasharray="6 3"
					/>
				{/if}
				{#if clNonlinearPath}
					<path
						data-testid="cl-nonlinear-path"
						d={clNonlinearPath}
						fill="none"
						stroke="#3b82f6"
						stroke-width="1.5"
					/>
				{/if}
				<text
					x={PAD.left + CHART_W / 2}
					y={SVG_H - 2}
					text-anchor="middle"
					font-size="9"
					fill="#6b7280">Time (s)</text
				>
				<text
					x={10}
					y={PAD.top + CHART_H / 2}
					text-anchor="middle"
					font-size="9"
					fill="#6b7280"
					transform="rotate(-90, 10, {PAD.top + CHART_H / 2})">Position (m)</text
				>
			</svg>

			<div class="space-y-2 text-xs">
				<div class="flex flex-wrap gap-4">
					<span class="flex items-center gap-1">
						<span class="inline-block h-0.5 w-4 bg-blue-500"></span> game-truth (nonlinear plant)
					</span>
					<span class="flex items-center gap-1">
						<span class="inline-block h-0.5 w-4 border-t-2 border-dashed border-amber-400"></span>
						textbook (linear model)
					</span>
					<span class="flex items-center gap-1">
						<span class="inline-block h-0.5 w-4 border-t-2 border-dashed border-red-400"></span>
						setpoint
					</span>
				</div>

				<table class="w-full border text-xs">
					<thead class="bg-gray-100">
						<tr>
							<th class="px-2 py-1 text-left font-semibold text-gray-600">Metric</th>
							<th class="px-2 py-1 text-right font-semibold text-amber-600">Textbook</th>
							<th class="px-2 py-1 text-right font-semibold text-blue-600">Game-truth</th>
						</tr>
					</thead>
					<tbody>
						<tr class="border-t">
							<td class="px-2 py-1">Overshoot</td>
							<td class="px-2 py-1 text-right font-mono"
								>{clLinearMetrics?.overshootPercent != null
									? clLinearMetrics.overshootPercent.toFixed(1) + ' %'
									: '—'}</td
							>
							<td class="px-2 py-1 text-right font-mono"
								>{clNonlinearMetrics?.overshootPercent != null
									? clNonlinearMetrics.overshootPercent.toFixed(1) + ' %'
									: '—'}</td
							>
						</tr>
						<tr class="border-t">
							<td class="px-2 py-1">Settling time (±10%)</td>
							<td class="px-2 py-1 text-right font-mono"
								>{clLinearMetrics?.settleTimeSec != null
									? clLinearMetrics.settleTimeSec.toFixed(2) + ' s'
									: '—'}</td
							>
							<td class="px-2 py-1 text-right font-mono"
								>{clNonlinearMetrics?.settleTimeSec != null
									? clNonlinearMetrics.settleTimeSec.toFixed(2) + ' s'
									: '—'}</td
							>
						</tr>
						<tr class="border-t">
							<td class="px-2 py-1">Oscillation half-cycles</td>
							<td class="px-2 py-1 text-right font-mono"
								>{clLinearMetrics ? clLinearMetrics.oscillationCount : '—'}</td
							>
							<td class="px-2 py-1 text-right font-mono"
								>{clNonlinearMetrics ? clNonlinearMetrics.oscillationCount : '—'}</td
							>
						</tr>
						<tr class="border-t">
							<td class="px-2 py-1">Decay ratio</td>
							<td class="px-2 py-1 text-right font-mono"
								>{clLinearMetrics?.decayRatio != null
									? clLinearMetrics.decayRatio.toFixed(3)
									: '—'}</td
							>
							<td class="px-2 py-1 text-right font-mono"
								>{clNonlinearMetrics?.decayRatio != null
									? clNonlinearMetrics.decayRatio.toFixed(3)
									: '—'}</td
							>
						</tr>
					</tbody>
				</table>

				{#if clSource === 'onoff'}
					<p class="rounded bg-gray-50 px-2 py-1 text-gray-600">
						Relay (on-off) control has no linear equivalent — observe the sustained limit cycle in
						the game-truth trace instead. Hysteresis sets its amplitude and period.
					</p>
				{/if}
			</div>
		</div>

		<details class="mt-3 rounded border bg-gray-50 px-3 py-2 text-xs text-gray-700">
			<summary class="cursor-pointer font-semibold">Why the game differs from the textbook</summary>
			<ul class="mt-2 list-disc space-y-1 pl-5">
				<li>
					<strong>One-sided thrust (arcade):</strong> the actuator only pushes up (u ∈ [0, 40] N).
					Braking an upward move relies on gravity alone, so up- and down-steps respond differently,
					and the integral term must hold u_eq = m·g ≈ 9.81 N just to hover. The
					<em>lab</em> actuator removes this by commanding a symmetric deviation u′ around hover.
				</li>
				<li>
					<strong>Actuator saturation:</strong> whenever the commanded force hits a limit the loop leaves
					the linear regime — large steps or aggressive gains diverge from the textbook trace first.
				</li>
				<li>
					<strong>Quadratic drag:</strong> the game plant includes c_d·v|v|. Its slope at hover (v = 0)
					is exactly zero, so the linearisation P(s) = 1/(m·s²) is correct — but at speed the drag adds
					damping the linear model does not know about, slightly reducing overshoot.
				</li>
				<li>
					<strong>Floor and ceiling:</strong> position is clamped to [0, 10] m and the run ends on contact
					— the linear model has no bounds.
				</li>
				<li>
					<strong>Sampling:</strong> the loop runs at 60 Hz with a filtered derivative; the continuous-time
					analysis ignores both (negligible at these bandwidths).
				</li>
			</ul>
		</details>
	</section>

	<!-- ── Bode Plots ──────────────────────────────────────────────────────── -->
	<section class="rounded-lg border p-4">
		<h2 class="mb-3 font-semibold">Bode Plot (PID open-loop &amp; closed-loop vs plant)</h2>
		<div class="grid gap-4 lg:grid-cols-2">
			<!-- Magnitude -->
			<div>
				<p class="mb-1 text-xs text-gray-600">Magnitude (dB)</p>
				<svg viewBox="0 0 {SVG_W} {SVG_H}" class="w-full">
					<line
						x1={PAD.left}
						y1={PAD.top}
						x2={PAD.left}
						y2={PAD.top + CHART_H}
						stroke="#9ca3af"
						stroke-width="1"
					/>
					<line
						x1={PAD.left}
						y1={PAD.top + CHART_H}
						x2={PAD.left + CHART_W}
						y2={PAD.top + CHART_H}
						stroke="#9ca3af"
						stroke-width="1"
					/>
					{#each magYTicks as db (db)}
						{@const yPx = mapY(db, MAG_MIN, MAG_MAX)}
						{#if yPx >= PAD.top && yPx <= PAD.top + CHART_H}
							<line
								x1={PAD.left}
								y1={yPx}
								x2={PAD.left + CHART_W}
								y2={yPx}
								stroke={db === 0 ? '#9ca3af' : '#e5e7eb'}
								stroke-width={db === 0 ? 1 : 0.8}
							/>
							<text x={PAD.left - 4} y={yPx + 4} text-anchor="end" font-size="9" fill="#6b7280"
								>{db}</text
							>
						{/if}
					{/each}
					{#each bodeXTicks as f (f)}
						{@const xPx = bodeX(f)}
						<text
							x={xPx}
							y={PAD.top + CHART_H + 14}
							text-anchor="middle"
							font-size="9"
							fill="#6b7280">{f}</text
						>
					{/each}
					{#if plantMagPath}
						<path d={plantMagPath} fill="none" stroke="#9ca3af" stroke-width="1.2" />
					{/if}
					{#if olMagPath}
						<path d={olMagPath} fill="none" stroke="#f59e0b" stroke-width="1.5" />
					{/if}
					{#if clMagPath}
						<path d={clMagPath} fill="none" stroke="#3b82f6" stroke-width="1.5" />
					{/if}
					<text
						x={PAD.left + CHART_W / 2}
						y={SVG_H - 2}
						text-anchor="middle"
						font-size="9"
						fill="#6b7280">ω (rad/s)</text
					>
				</svg>
			</div>
			<!-- Phase -->
			<div>
				<p class="mb-1 text-xs text-gray-600">Phase (degrees)</p>
				<svg viewBox="0 0 {SVG_W} {SVG_H}" class="w-full">
					<line
						x1={PAD.left}
						y1={PAD.top}
						x2={PAD.left}
						y2={PAD.top + CHART_H}
						stroke="#9ca3af"
						stroke-width="1"
					/>
					<line
						x1={PAD.left}
						y1={PAD.top + CHART_H}
						x2={PAD.left + CHART_W}
						y2={PAD.top + CHART_H}
						stroke="#9ca3af"
						stroke-width="1"
					/>
					{#each phaseYTicks as ph (ph)}
						{@const yPx = mapY(ph, PH_MIN, PH_MAX)}
						{#if yPx >= PAD.top && yPx <= PAD.top + CHART_H}
							<line
								x1={PAD.left}
								y1={yPx}
								x2={PAD.left + CHART_W}
								y2={yPx}
								stroke={ph === -180 ? '#fca5a5' : '#e5e7eb'}
								stroke-width={ph === -180 ? 1 : 0.8}
							/>
							<text x={PAD.left - 4} y={yPx + 4} text-anchor="end" font-size="9" fill="#6b7280"
								>{ph}°</text
							>
						{/if}
					{/each}
					{#each bodeXTicks as f (f)}
						{@const xPx = bodeX(f)}
						<text
							x={xPx}
							y={PAD.top + CHART_H + 14}
							text-anchor="middle"
							font-size="9"
							fill="#6b7280">{f}</text
						>
					{/each}
					{#if plantPhasePath}
						<path d={plantPhasePath} fill="none" stroke="#9ca3af" stroke-width="1.2" />
					{/if}
					{#if olPhasePath}
						<path d={olPhasePath} fill="none" stroke="#f59e0b" stroke-width="1.5" />
					{/if}
					{#if clPhasePath}
						<path d={clPhasePath} fill="none" stroke="#3b82f6" stroke-width="1.5" />
					{/if}
					<text
						x={PAD.left + CHART_W / 2}
						y={SVG_H - 2}
						text-anchor="middle"
						font-size="9"
						fill="#6b7280">ω (rad/s)</text
					>
				</svg>
			</div>
		</div>
		<div class="mt-2 flex flex-wrap gap-4 text-xs">
			<span class="flex items-center gap-1">
				<span class="inline-block h-0.5 w-4 bg-gray-400"></span> Plant P(s)
			</span>
			<span class="flex items-center gap-1">
				<span class="inline-block h-0.5 w-4 bg-amber-400"></span> Open-loop L(s)
			</span>
			<span class="flex items-center gap-1">
				<span class="inline-block h-0.5 w-4 bg-blue-500"></span> Closed-loop T(s)
			</span>
		</div>
	</section>

	<!-- ── Controller Tuning ────────────────────────────────────────────────── -->
	<div class="grid gap-6 lg:grid-cols-2">
		<!-- On-Off tuning -->
		<section class="rounded-lg border p-4">
			<h2 class="mb-3 font-semibold">On-Off Controller</h2>
			<div class="space-y-2">
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">High output (N)</span>
					<input
						type="number"
						min="0"
						max={physicsParams.uMax}
						step="1"
						bind:value={onoffParams.highOutput}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Low output (N)</span>
					<input
						type="number"
						min="0"
						max={physicsParams.uMax}
						step="1"
						bind:value={onoffParams.lowOutput}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Threshold (m)</span>
					<input
						type="number"
						min="0"
						max="2"
						step="0.05"
						bind:value={onoffParams.threshold}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Hysteresis (m)</span>
					<input
						type="number"
						min="0"
						max="1"
						step="0.05"
						bind:value={onoffParams.hysteresis}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
			</div>
			<button
				onclick={applyOnOff}
				class="mt-3 rounded bg-orange-500 px-4 py-1 text-xs font-semibold text-white hover:bg-orange-600"
			>
				Apply to Auto Mode
			</button>
		</section>

		<!-- PID tuning -->
		<section class="rounded-lg border p-4">
			<h2 class="mb-3 font-semibold">PID Controller</h2>
			<div class="space-y-2">
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Kp (proportional)</span>
					<input
						type="number"
						min="0"
						max="50"
						step="0.5"
						bind:value={pidParams.kp}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Ki (integral)</span>
					<input
						type="number"
						min="0"
						max="20"
						step="0.1"
						bind:value={pidParams.ki}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Kd (derivative)</span>
					<input
						type="number"
						min="0"
						max="10"
						step="0.1"
						bind:value={pidParams.kd}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Derivative filter</span>
					<input
						type="number"
						min="0"
						max="0.99"
						step="0.05"
						bind:value={pidParams.filterCoeff}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Output min (N)</span>
					<input
						type="number"
						min="0"
						max={physicsParams.uMax}
						step="1"
						bind:value={pidParams.outputMin}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-xs">
					<span class="w-28">Output max (N)</span>
					<input
						type="number"
						min="0"
						max={physicsParams.uMax}
						step="1"
						bind:value={pidParams.outputMax}
						class="w-20 rounded border px-2 py-0.5"
					/>
				</label>
			</div>
			<button
				onclick={applyPID}
				class="mt-3 rounded bg-blue-600 px-4 py-1 text-xs font-semibold text-white hover:bg-blue-700"
			>
				Apply to Auto Mode
			</button>
		</section>
	</div>

	<!-- ── G(s) Transfer Function Controller ─────────────────────────────────── -->
	<section class="rounded-lg border p-4">
		<h2 class="mb-1 font-semibold">Transfer Function Controller C(s) = N(s) / D(s)</h2>
		<p class="mb-3 text-xs text-gray-500">
			Enter polynomial coefficients highest-power first (space or comma separated). System must be
			proper: deg(N) ≤ deg(D). Sample period T = {(DEFAULT_TF_PARAMS.dt * 1000).toFixed(2)} ms (fixed).
		</p>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<label class="flex flex-col gap-1 text-xs">
					<span class="font-medium">Numerator N(s) coefficients</span>
					<input
						type="text"
						bind:value={tfNumStr}
						placeholder="e.g.  2  8  (for 2s + 8)"
						class="rounded border px-2 py-1 font-mono text-xs"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs">
					<span class="font-medium">Denominator D(s) coefficients</span>
					<input
						type="text"
						bind:value={tfDenStr}
						placeholder="e.g.  0.05  1  (for 0.05s + 1)"
						class="rounded border px-2 py-1 font-mono text-xs"
					/>
				</label>
				<div class="flex gap-3">
					<label class="flex items-center gap-1 text-xs">
						<span>u_min (N)</span>
						<input
							type="number"
							min="0"
							max="40"
							step="1"
							bind:value={tfOutputMin}
							class="w-16 rounded border px-2 py-0.5"
						/>
					</label>
					<label class="flex items-center gap-1 text-xs">
						<span>u_max (N)</span>
						<input
							type="number"
							min="0"
							max="40"
							step="1"
							bind:value={tfOutputMax}
							class="w-16 rounded border px-2 py-0.5"
						/>
					</label>
				</div>
			</div>

			<div class="space-y-2 text-xs">
				{#if tfInfo.ok && tfInfo.discNum && tfInfo.discDen}
					<p class="font-medium text-gray-700">
						Discretised C(z) — Tustin (T = {(DEFAULT_TF_PARAMS.dt * 1000).toFixed(2)} ms):
					</p>
					<p class="font-mono text-gray-800">
						N(z) = {formatPolyZ(tfInfo.discNum)}
					</p>
					<p class="font-mono text-gray-800">
						D(z) = {formatPolyZ(tfInfo.discDen)}
					</p>
					{#if tfInfo.poles && tfInfo.poles.length > 0}
						<p class="mt-1 font-medium text-gray-700">
							Discrete controller poles (|z| &lt; 1 → stable):
						</p>
						{#each tfInfo.poles as pole, i (i)}
							<p
								class="font-mono {Math.sqrt(pole.re * pole.re + pole.im * pole.im) < 1
									? 'text-emerald-700'
									: 'text-red-600'}"
							>
								z{i + 1} = {pole.re.toFixed(4)}
								{pole.im >= 0 ? '+' : ''}{pole.im.toFixed(4)}j |z| = {Math.sqrt(
									pole.re * pole.re + pole.im * pole.im
								).toFixed(4)}
							</p>
						{/each}
					{/if}
					<div
						class="mt-2 rounded px-2 py-1 {tfInfo.stable
							? 'bg-emerald-50 text-emerald-800'
							: 'bg-red-50 text-red-800'}"
					>
						{tfInfo.stable
							? 'Controller poles: STABLE (all |z| < 1)'
							: 'Controller poles: UNSTABLE (|z| ≥ 1 detected)'}
					</div>
				{:else if !tfInfo.ok}
					<p class="rounded bg-amber-50 px-2 py-1 text-amber-800">{tfInfo.error}</p>
				{/if}
			</div>
		</div>

		<button
			onclick={applyTF}
			disabled={!tfInfo.ok}
			class="mt-3 rounded bg-purple-600 px-4 py-1 text-xs font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
		>
			Apply to Auto Mode (Transfer Function)
		</button>
	</section>

	{#if applyFeedback}
		<p class="rounded bg-green-100 px-4 py-2 text-sm text-green-800">{applyFeedback}</p>
	{/if}
</main>
