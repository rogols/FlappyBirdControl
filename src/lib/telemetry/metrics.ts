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
