/**
 * Unit tests for src/lib/telemetry/metrics.ts
 *
 * Validates:
 * - Empty / single-sample edge cases return zeroed metrics
 * - ISE, IAE, ITAE computed correctly via trapezoidal rule
 * - Peak error detection
 * - Settling time detection: correct entry time, reset on exit, null when never settled
 * - Total effort computation
 * - Duration from sample window
 * - Custom config (settleThreshold, settleWindow)
 */

import { describe, it, expect } from 'vitest';
import { computeMetrics } from './metrics';
import type { TelemetrySample } from './recorder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(t: number, error: number, control: number = 0, y: number = 5): TelemetrySample {
	return { t, y, v: 0, setpoint: y + error, error, control };
}

/** Build a constant-error history at uniform 1/60 s intervals */
function constantErrorHistory(
	errorValue: number,
	nSamples: number,
	controlValue: number = 0
): TelemetrySample[] {
	const dt = 1 / 60;
	return Array.from({ length: nSamples }, (_, i) => makeSample(i * dt, errorValue, controlValue));
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeMetrics — edge cases', () => {
	it('returns zero metrics for empty history', () => {
		const m = computeMetrics([]);
		expect(m.ise).toBe(0);
		expect(m.iae).toBe(0);
		expect(m.itae).toBe(0);
		expect(m.peakError).toBe(0);
		expect(m.settleTimeSec).toBeNull();
		expect(m.totalEffort).toBe(0);
		expect(m.durationSec).toBe(0);
		expect(m.sampleCount).toBe(0);
	});

	it('returns zero metrics for a single sample', () => {
		const m = computeMetrics([makeSample(1.0, 0.5)]);
		expect(m.ise).toBe(0);
		expect(m.iae).toBe(0);
		expect(m.sampleCount).toBe(1);
	});

	it('reports correct sampleCount', () => {
		const history = constantErrorHistory(1, 10);
		const m = computeMetrics(history);
		expect(m.sampleCount).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// ISE / IAE / ITAE — exact values
// ---------------------------------------------------------------------------

describe('computeMetrics — ISE', () => {
	it('computes ISE = e² * T for constant error over T seconds (two samples)', () => {
		// Constant e = 2 for 1 s → ISE = ∫₀¹ 4 dt = 4
		const samples = [makeSample(0, 2), makeSample(1, 2)];
		const m = computeMetrics(samples);
		expect(m.ise).toBeCloseTo(4, 6);
	});

	it('ISE is zero for zero error history', () => {
		const m = computeMetrics(constantErrorHistory(0, 60));
		expect(m.ise).toBe(0);
	});

	it('ISE is symmetric: same value for +e and -e', () => {
		const pos = computeMetrics([makeSample(0, 3), makeSample(1, 3)]);
		const neg = computeMetrics([makeSample(0, -3), makeSample(1, -3)]);
		expect(pos.ise).toBeCloseTo(neg.ise, 10);
	});
});

describe('computeMetrics — IAE', () => {
	it('computes IAE = |e| * T for constant error over T seconds', () => {
		// Constant e = -3 for 2 s → IAE = 6
		const samples = [makeSample(0, -3), makeSample(2, -3)];
		const m = computeMetrics(samples);
		expect(m.iae).toBeCloseTo(6, 6);
	});

	it('IAE ≤ ISE for |e| > 1 (because e² > |e| when |e|>1)', () => {
		// e = 5 for 1 s: IAE = 5, ISE = 25
		const samples = [makeSample(0, 5), makeSample(1, 5)];
		const m = computeMetrics(samples);
		expect(m.ise).toBeGreaterThan(m.iae);
	});
});

describe('computeMetrics — ITAE', () => {
	it('ITAE = 0 at t=0 (error at t=0 contributes nothing to t·|e|)', () => {
		// Two samples at t=0 and t=1: ITAE ≈ ∫₀¹ t·e dt
		// Trapezoid: (0·e0 + 1·e1)/2 * 1 = e/2
		const samples = [makeSample(0, 4), makeSample(1, 4)];
		const m = computeMetrics(samples);
		// IAE = 4, ITAE ≈ (0*4 + 1*4)/2 * 1 = 2
		expect(m.itae).toBeCloseTo(2, 5);
	});

	it('ITAE < IAE * duration when the response settles early', () => {
		// Error = 2 from t=0..0.5, then 0 from t=0.5..2
		const samples: TelemetrySample[] = [
			makeSample(0, 2),
			makeSample(0.5, 2),
			makeSample(0.5 + 1 / 60, 0),
			makeSample(2, 0)
		];
		const m = computeMetrics(samples);
		expect(m.itae).toBeLessThan(m.iae * 2);
	});
});

// ---------------------------------------------------------------------------
// Peak error
// ---------------------------------------------------------------------------

describe('computeMetrics — peak error', () => {
	it('detects peak error from the history', () => {
		const samples = [makeSample(0, 1), makeSample(1, -5), makeSample(2, 2)];
		const m = computeMetrics(samples);
		expect(m.peakError).toBeCloseTo(5, 6);
	});

	it('peak error detected in the last sample', () => {
		const samples = [makeSample(0, 1), makeSample(1, 2), makeSample(2, -8)];
		const m = computeMetrics(samples);
		expect(m.peakError).toBeCloseTo(8, 6);
	});

	it('peak error is zero when all errors are zero', () => {
		const m = computeMetrics(constantErrorHistory(0, 30));
		expect(m.peakError).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Settling time
// ---------------------------------------------------------------------------

describe('computeMetrics — settling time', () => {
	it('returns null when response never enters settle band', () => {
		const m = computeMetrics(constantErrorHistory(5, 120));
		expect(m.settleTimeSec).toBeNull();
	});

	it('detects settling when error stays within threshold for settleWindow', () => {
		const dt = 1 / 60;
		const preSamples = Array.from({ length: 30 }, (_, i) => makeSample(i * dt, 3));
		// Settle at t = 30/60 = 0.5 s; settleWindow default = 1 s
		const postSamples = Array.from({ length: 120 }, (_, i) => makeSample(0.5 + i * dt, 0.1));
		const m = computeMetrics([...preSamples, ...postSamples]);
		expect(m.settleTimeSec).not.toBeNull();
		// Should settle around t=0.5 s after start
		expect(m.settleTimeSec!).toBeGreaterThanOrEqual(0.4);
		expect(m.settleTimeSec!).toBeLessThan(0.6);
	});

	it('resets band entry when error exits the band', () => {
		const dt = 1 / 60;
		// In band for 0.5 s, then spike, then in band for full window
		const inBand1 = Array.from({ length: 30 }, (_, i) => makeSample(i * dt, 0.05));
		const spike = [makeSample(30 * dt, 2)];
		const inBand2 = Array.from({ length: 120 }, (_, i) => makeSample(31 * dt + i * dt, 0.05));
		const m = computeMetrics([...inBand1, ...spike, ...inBand2]);
		// Should settle only after the spike, not at t=0
		expect(m.settleTimeSec).not.toBeNull();
		expect(m.settleTimeSec!).toBeGreaterThan(0.4);
	});

	it('custom settleThreshold and settleWindow are respected', () => {
		// Error = 0.5 — outside default threshold (0.2) but inside custom threshold (1.0)
		const dt = 1 / 60;
		const samples = Array.from({ length: 120 }, (_, i) => makeSample(i * dt, 0.5));
		const mDefault = computeMetrics(samples);
		const mCustom = computeMetrics(samples, { settleThreshold: 1.0, settleWindow: 0.5 });
		expect(mDefault.settleTimeSec).toBeNull();
		expect(mCustom.settleTimeSec).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Total effort
// ---------------------------------------------------------------------------

describe('computeMetrics — total effort', () => {
	it('computes effort = ∫|u| dt for constant control', () => {
		// u = 10 for 2 s → effort = 20
		const samples = [makeSample(0, 0, 10), makeSample(2, 0, 10)];
		const m = computeMetrics(samples);
		expect(m.totalEffort).toBeCloseTo(20, 6);
	});

	it('effort is zero when control is always zero', () => {
		const m = computeMetrics(constantErrorHistory(1, 60, 0));
		expect(m.totalEffort).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

describe('computeMetrics — duration', () => {
	it('duration = t_last - t_first', () => {
		const samples = [makeSample(2.5, 0), makeSample(5.0, 0)];
		const m = computeMetrics(samples);
		expect(m.durationSec).toBeCloseTo(2.5, 6);
	});
});
