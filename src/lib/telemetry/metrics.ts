/**
 * Performance metrics computed from a telemetry history.
 *
 * Classic control-performance indices useful for classroom comparison:
 *
 * | Metric | Formula            | Penalises                    |
 * |--------|--------------------|------------------------------|
 * | ISE    | ∫ e²(t) dt         | Large errors most             |
 * | IAE    | ∫ |e(t)| dt        | All errors equally            |
 * | ITAE   | ∫ t·|e(t)| dt      | Late errors most (best for    |
 * |        |                    | comparing settling speed)     |
 *
 * Additional scalar metrics:
 * - Peak absolute error
 * - Settling time (first time |e| stays ≤ threshold for `settleWindow` s)
 * - Total control effort (∫ |u(t)| dt)
 *
 * All integrals are computed via the trapezoidal rule over the sample history.
 */

import type { TelemetrySample } from './recorder.ts';

export interface PerformanceMetrics {
	/** Integral of Squared Error: ∫ e²(t) dt */
	ise: number;
	/** Integral of Absolute Error: ∫ |e(t)| dt */
	iae: number;
	/** Integral of Time-weighted Absolute Error: ∫ t·|e(t)| dt */
	itae: number;
	/** Maximum absolute error observed */
	peakError: number;
	/**
	 * Settling time (seconds from the start of the history) defined as the
	 * first time |e(t)| enters and stays within `settleThreshold` for at least
	 * `settleWindow` seconds.  `null` if the response never settled.
	 */
	settleTimeSec: number | null;
	/** Total control effort: ∫ |u(t)| dt */
	totalEffort: number;
	/** Duration of the sample window (s): t_last − t_first */
	durationSec: number;
	/** Number of samples used for computation */
	sampleCount: number;
}

export interface MetricsConfig {
	/**
	 * Error band within which the output is considered "settled" (same units as
	 * the error signal, i.e. world units / metres).
	 * Default: 0.2
	 */
	settleThreshold?: number;
	/**
	 * Time the output must stay within the settle band before it is declared
	 * settled (seconds).
	 * Default: 1.0
	 */
	settleWindow?: number;
}

const DEFAULT_SETTLE_THRESHOLD = 0.2;
const DEFAULT_SETTLE_WINDOW = 1.0;

/**
 * Compute performance metrics from a telemetry sample array.
 *
 * The samples must be in chronological order (oldest first), as returned by
 * `TelemetryRecorder.getHistory()`.  Returns a zeroed metrics object when
 * fewer than 2 samples are provided.
 */
export function computeMetrics(
	samples: TelemetrySample[],
	config: MetricsConfig = {}
): PerformanceMetrics {
	const n = samples.length;

	const zero: PerformanceMetrics = {
		ise: 0,
		iae: 0,
		itae: 0,
		peakError: 0,
		settleTimeSec: null,
		totalEffort: 0,
		durationSec: 0,
		sampleCount: n
	};

	if (n < 2) return zero;

	const settleThreshold = config.settleThreshold ?? DEFAULT_SETTLE_THRESHOLD;
	const settleWindow = config.settleWindow ?? DEFAULT_SETTLE_WINDOW;

	const t0 = samples[0].t;
	const tEnd = samples[n - 1].t;

	let ise = 0;
	let iae = 0;
	let itae = 0;
	let totalEffort = 0;
	let peakError = 0;

	// Trapezoidal integration: ∫ f(t) dt ≈ Σ (f_k + f_{k+1}) / 2 * Δt
	for (let k = 0; k < n - 1; k++) {
		const s0 = samples[k];
		const s1 = samples[k + 1];
		const dt = s1.t - s0.t;
		if (dt <= 0) continue;

		const absE0 = Math.abs(s0.error);
		const absE1 = Math.abs(s1.error);
		const t0k = s0.t - t0; // time relative to window start

		ise += ((s0.error * s0.error + s1.error * s1.error) / 2) * dt;
		iae += ((absE0 + absE1) / 2) * dt;
		itae += ((t0k * absE0 + (t0k + dt) * absE1) / 2) * dt;
		totalEffort += ((Math.abs(s0.control) + Math.abs(s1.control)) / 2) * dt;

		if (absE0 > peakError) peakError = absE0;
	}
	// Check last sample peak
	if (Math.abs(samples[n - 1].error) > peakError) {
		peakError = Math.abs(samples[n - 1].error);
	}

	// Settling time: scan forward for first entry into ±settleThreshold that
	// stays there for settleWindow seconds
	let settleTimeSec: number | null = null;
	let bandEntryTime: number | null = null;

	for (let k = 0; k < n; k++) {
		const s = samples[k];
		const inBand = Math.abs(s.error) <= settleThreshold;

		if (inBand) {
			if (bandEntryTime === null) {
				bandEntryTime = s.t;
			} else if (s.t - bandEntryTime >= settleWindow) {
				settleTimeSec = bandEntryTime - t0;
				break;
			}
		} else {
			// Left the band — reset
			bandEntryTime = null;
		}
	}

	return {
		ise,
		iae,
		itae,
		peakError,
		settleTimeSec,
		totalEffort,
		durationSec: tEnd - t0,
		sampleCount: n
	};
}

/**
 * Format a metrics value for display.
 * Returns a string with the value rounded to the given number of decimal places.
 */
export function formatMetric(value: number, decimals = 2): string {
	return value.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Step-response metrics
// ---------------------------------------------------------------------------

/**
 * Metrics for one setpoint-step segment: the samples between one setpoint
 * change and the next (or the end of the history).
 *
 * These are the classic step-response characteristics from introductory
 * control theory, measured on the live run so students can compare what they
 * see in the game against textbook predictions.
 */
export interface StepSegmentMetrics {
	/** Time of the setpoint change (s, absolute sample time) */
	stepTime: number;
	/** Setpoint before the change (world units) */
	fromSetpoint: number;
	/** Setpoint after the change (world units) */
	toSetpoint: number;
	/** Signed step size: toSetpoint − fromSetpoint (world units) */
	stepSize: number;
	/**
	 * Overshoot as a percentage of the step size:
	 *   100 · max(sign(step)·(y − toSetpoint)) / |step|, counted only after y
	 * first reaches the new setpoint. `null` if the output never reached the
	 * target within the segment; `0` if it reached it without overshooting.
	 */
	overshootPercent: number | null;
	/**
	 * Number of completed oscillation half-cycles whose error peak exceeds the
	 * settle band. Residual crossings inside the band do not count.
	 * 0 for a monotonic (overdamped) response.
	 */
	oscillationCount: number;
	/**
	 * Classic decay ratio: the ratio of the second same-side error peak to the
	 * first (peaks one full period apart). ≈ e^(−2πζ/√(1−ζ²)) for a 2nd-order
	 * underdamped system. `null` when fewer than two same-side peaks exist.
	 */
	decayRatio: number | null;
	/**
	 * Settling time measured from the setpoint change (s): first entry into the
	 * band |y − toSetpoint| ≤ max(bandFraction·|step|, bandMin) that holds for
	 * `settleWindow` seconds. `null` if the segment never settles.
	 */
	settleTimeSec: number | null;
}

/** Aggregate of all step segments in a run, for compact display and storage. */
export interface StepMetricsSummary {
	/** Number of analysed step segments */
	stepCount: number;
	/** Mean overshoot % over segments where the target was reached; null if none */
	meanOvershootPercent: number | null;
	/** Mean oscillation (half-cycle) count per segment */
	meanOscillationCount: number | null;
	/** Mean settling time over segments that settled (s); null if none settled */
	meanSettleTimeSec: number | null;
	/** Largest (slowest-decaying) decay ratio observed; null if none measurable */
	worstDecayRatio: number | null;
}

export interface StepMetricsConfig {
	/** Segments shorter than this are skipped (s). Default: 1.0 */
	minSegmentSec?: number;
	/** Settle band as a fraction of the step size. Default: 0.1 (±10%) */
	settleBandFraction?: number;
	/** Lower bound on the settle band (world units). Default: 0.1 */
	settleBandMin?: number;
	/** Time the output must stay in band to count as settled (s). Default: 1.0 */
	settleWindow?: number;
}

const DEFAULT_MIN_SEGMENT_SEC = 1.0;
const DEFAULT_SETTLE_BAND_FRACTION = 0.1;
const DEFAULT_SETTLE_BAND_MIN = 0.1;

/**
 * Split a telemetry history at setpoint changes and compute step-response
 * metrics for each resulting segment.
 *
 * Samples must be in chronological order. Segments shorter than
 * `minSegmentSec` (e.g. a step right before the run ended) are skipped.
 */
export function computeStepResponseMetrics(
	samples: TelemetrySample[],
	config: StepMetricsConfig = {}
): StepSegmentMetrics[] {
	const minSegmentSec = config.minSegmentSec ?? DEFAULT_MIN_SEGMENT_SEC;

	if (samples.length < 2) return [];

	// Indices where the setpoint differs from the previous sample
	const changeIndices: number[] = [];
	for (let k = 1; k < samples.length; k++) {
		if (samples[k].setpoint !== samples[k - 1].setpoint) {
			changeIndices.push(k);
		}
	}

	const segments: StepSegmentMetrics[] = [];
	for (let c = 0; c < changeIndices.length; c++) {
		const start = changeIndices[c];
		const end = c + 1 < changeIndices.length ? changeIndices[c + 1] : samples.length;
		const segment = samples.slice(start, end);
		if (segment.length < 2) continue;
		if (segment[segment.length - 1].t - segment[0].t < minSegmentSec) continue;

		const fromSetpoint = samples[start - 1].setpoint;
		const toSetpoint = segment[0].setpoint;
		const stepSize = toSetpoint - fromSetpoint;
		if (stepSize === 0) continue;

		segments.push(analyzeStepSegment(segment, fromSetpoint, toSetpoint, stepSize, config));
	}

	return segments;
}

function analyzeStepSegment(
	segment: TelemetrySample[],
	fromSetpoint: number,
	toSetpoint: number,
	stepSize: number,
	config: StepMetricsConfig
): StepSegmentMetrics {
	const bandFraction = config.settleBandFraction ?? DEFAULT_SETTLE_BAND_FRACTION;
	const bandMin = config.settleBandMin ?? DEFAULT_SETTLE_BAND_MIN;
	const settleWindow = config.settleWindow ?? DEFAULT_SETTLE_WINDOW;

	const stepTime = segment[0].t;
	const direction = Math.sign(stepSize);

	// First index at which the output reaches (or crosses) the new setpoint
	let crossIndex = -1;
	for (let k = 0; k < segment.length; k++) {
		if (direction * (segment[k].y - toSetpoint) >= 0) {
			crossIndex = k;
			break;
		}
	}

	// Overshoot: largest excursion past the new setpoint after first reaching it.
	// An overdamped response that settles without ever crossing the target
	// counts as 0% overshoot (resolved after the settling scan below).
	let overshootPercent: number | null = null;
	if (crossIndex >= 0) {
		let maxExcursion = 0;
		for (let k = crossIndex; k < segment.length; k++) {
			const excursion = direction * (segment[k].y - toSetpoint);
			if (excursion > maxExcursion) maxExcursion = excursion;
		}
		overshootPercent = (100 * maxExcursion) / Math.abs(stepSize);
	}

	// Settling time relative to the step, on the error w.r.t. the new setpoint
	const settleBand = Math.max(bandFraction * Math.abs(stepSize), bandMin);
	let settleTimeSec: number | null = null;
	let bandEntryTime: number | null = null;
	for (let k = 0; k < segment.length; k++) {
		const inBand = Math.abs(segment[k].y - toSetpoint) <= settleBand;
		if (inBand) {
			if (bandEntryTime === null) {
				bandEntryTime = segment[k].t;
			} else if (segment[k].t - bandEntryTime >= settleWindow) {
				settleTimeSec = bandEntryTime - stepTime;
				break;
			}
		} else {
			bandEntryTime = null;
		}
	}

	// Oscillation count and half-cycle error peaks after the first crossing.
	// A sign change of e = toSetpoint − y closes one half-cycle; the peak |e|
	// of each half-cycle drives the decay ratio. Only half-cycles whose peak
	// exceeds the settle band count as oscillations — residual crossings inside
	// the band are regulation noise, not what a student means by "how many
	// times did it oscillate".
	let oscillationCount = 0;
	const halfCyclePeaks: number[] = [];
	if (crossIndex >= 0) {
		let currentSign = 0;
		let currentPeak = 0;
		for (let k = crossIndex; k < segment.length; k++) {
			const e = toSetpoint - segment[k].y;
			const s = Math.sign(e);
			if (s !== 0) {
				if (currentSign === 0) {
					currentSign = s;
				} else if (s !== currentSign) {
					halfCyclePeaks.push(currentPeak);
					if (currentPeak > settleBand) oscillationCount++;
					currentSign = s;
					currentPeak = 0;
				}
			}
			const absE = Math.abs(e);
			if (absE > currentPeak) currentPeak = absE;
		}
		if (currentSign !== 0) halfCyclePeaks.push(currentPeak);
	}

	// Decay ratio: same-side peaks are one full period apart, i.e. every other
	// half-cycle peak. Requires at least three half-cycle peaks (peak, counter
	// peak, second same-side peak).
	let decayRatio: number | null = null;
	if (halfCyclePeaks.length >= 3 && halfCyclePeaks[0] > 1e-12) {
		decayRatio = halfCyclePeaks[2] / halfCyclePeaks[0];
	}

	// Settled without ever crossing the target: overdamped, zero overshoot
	if (overshootPercent === null && settleTimeSec !== null) {
		overshootPercent = 0;
	}

	return {
		stepTime,
		fromSetpoint,
		toSetpoint,
		stepSize,
		overshootPercent,
		oscillationCount,
		decayRatio,
		settleTimeSec
	};
}

/**
 * Aggregate per-segment step metrics into a run-level summary.
 */
export function summarizeStepMetrics(segments: StepSegmentMetrics[]): StepMetricsSummary {
	const overshoots = segments.map((s) => s.overshootPercent).filter((v): v is number => v !== null);
	const settles = segments.map((s) => s.settleTimeSec).filter((v): v is number => v !== null);
	const decays = segments.map((s) => s.decayRatio).filter((v): v is number => v !== null);

	const mean = (values: number[]): number | null =>
		values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

	return {
		stepCount: segments.length,
		meanOvershootPercent: mean(overshoots),
		meanOscillationCount: mean(segments.map((s) => s.oscillationCount)),
		meanSettleTimeSec: mean(settles),
		worstDecayRatio: decays.length > 0 ? Math.max(...decays) : null
	};
}

/**
 * Fraction of samples whose control output sits at an actuator limit.
 *
 * A high value warns that the loop is operating outside the linear regime the
 * analysis views assume — the plant is not receiving what the linear
 * controller asked for.
 *
 * @param samples - Telemetry history (control values are controller outputs)
 * @param outputMin - Lower controller output limit
 * @param outputMax - Upper controller output limit
 * @param tolerance - Distance from a limit that still counts as saturated.
 *                    Default: 1e-6 · (outputMax − outputMin)
 */
export function saturationFraction(
	samples: TelemetrySample[],
	outputMin: number,
	outputMax: number,
	tolerance?: number
): number {
	if (samples.length === 0) return 0;
	const tol = tolerance ?? 1e-6 * (outputMax - outputMin);
	let saturated = 0;
	for (const s of samples) {
		if (s.control <= outputMin + tol || s.control >= outputMax - tol) {
			saturated++;
		}
	}
	return saturated / samples.length;
}
