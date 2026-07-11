/**
 * Unit tests for the step-response metrics in src/lib/telemetry/metrics.ts
 * (computeStepResponseMetrics, summarizeStepMetrics, saturationFraction).
 *
 * Reference data: the analytical unit-step response of a standard 2nd-order
 * system  ÿ + 2ζωₙẏ + ωₙ²y = ωₙ²r:
 *
 *   underdamped (ζ < 1):
 *     y(t) = 1 − e^(−ζωₙt)·(cos(ω_d t) + ζ/√(1−ζ²)·sin(ω_d t)),  ω_d = ωₙ√(1−ζ²)
 *     overshoot  = e^(−πζ/√(1−ζ²))
 *     decayRatio = e^(−2πζ/√(1−ζ²))   (successive same-side peaks)
 *
 *   overdamped (ζ > 1): monotonic, zero overshoot, no oscillation.
 */

import { describe, it, expect } from 'vitest';
import { computeStepResponseMetrics, summarizeStepMetrics, saturationFraction } from './metrics';
import type { TelemetrySample } from './recorder';

const DT = 1 / 60;

/** Analytical underdamped 2nd-order unit-step response (ζ < 1). */
function underdampedStep(zeta: number, omegaN: number, t: number): number {
	const omegaD = omegaN * Math.sqrt(1 - zeta * zeta);
	const envelope = Math.exp(-zeta * omegaN * t);
	return (
		1 -
		envelope * (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t))
	);
}

/** Analytical overdamped 2nd-order unit-step response (ζ > 1). */
function overdampedStep(zeta: number, omegaN: number, t: number): number {
	const s1 = omegaN * (-zeta + Math.sqrt(zeta * zeta - 1));
	const s2 = omegaN * (-zeta - Math.sqrt(zeta * zeta - 1));
	return 1 - (s2 / (s2 - s1)) * Math.exp(s1 * t) + (s1 / (s2 - s1)) * Math.exp(s2 * t);
}

/**
 * Build a telemetry history: setpoint 0 (output at rest) until stepTime,
 * then setpoint 1 with the given response function applied from the step.
 */
function stepHistory(
	response: (t: number) => number,
	stepTime: number,
	durationSec: number
): TelemetrySample[] {
	const samples: TelemetrySample[] = [];
	const n = Math.ceil(durationSec / DT);
	for (let k = 0; k <= n; k++) {
		const t = k * DT;
		const setpoint = t < stepTime ? 0 : 1;
		const y = t < stepTime ? 0 : response(t - stepTime);
		samples.push({ t, y, v: 0, setpoint, error: setpoint - y, control: 0 });
	}
	return samples;
}

describe('computeStepResponseMetrics — underdamped reference (ζ = 0.2)', () => {
	const zeta = 0.2;
	const samples = stepHistory((t) => underdampedStep(zeta, 2.0, t), 1.0, 25);
	const segments = computeStepResponseMetrics(samples);

	it('finds exactly one step segment with the right geometry', () => {
		expect(segments.length).toBe(1);
		expect(segments[0].fromSetpoint).toBe(0);
		expect(segments[0].toSetpoint).toBe(1);
		expect(segments[0].stepSize).toBe(1);
	});

	it('matches the analytical overshoot within 1%', () => {
		const expected = 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)); // 52.66%
		expect(segments[0].overshootPercent).not.toBeNull();
		expect(Math.abs(segments[0].overshootPercent! - expected)).toBeLessThan(expected * 0.01);
	});

	it('matches the analytical decay ratio within 2%', () => {
		const expected = Math.exp((-2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)); // 0.277
		expect(segments[0].decayRatio).not.toBeNull();
		expect(Math.abs(segments[0].decayRatio! - expected)).toBeLessThan(expected * 0.02);
	});

	it('counts oscillation half-cycles up to settling and reports a settle time', () => {
		// ζ = 0.2 crosses the target several times before entering the ±10% band
		expect(segments[0].oscillationCount).toBeGreaterThanOrEqual(2);
		expect(segments[0].oscillationCount).toBeLessThanOrEqual(8);
		expect(segments[0].settleTimeSec).not.toBeNull();
		expect(segments[0].settleTimeSec!).toBeGreaterThan(0);
	});
});

describe('computeStepResponseMetrics — underdamped reference (ζ = 0.5)', () => {
	const zeta = 0.5;
	const samples = stepHistory((t) => underdampedStep(zeta, 2.0, t), 1.0, 25);
	const segments = computeStepResponseMetrics(samples);

	it('matches the analytical overshoot within 1%', () => {
		const expected = 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)); // 16.30%
		expect(Math.abs(segments[0].overshootPercent! - expected)).toBeLessThan(expected * 0.01);
	});

	it('matches the analytical decay ratio within 5%', () => {
		const expected = Math.exp((-2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)); // 0.0265
		expect(segments[0].decayRatio).not.toBeNull();
		expect(Math.abs(segments[0].decayRatio! - expected)).toBeLessThan(expected * 0.05);
	});
});

describe('computeStepResponseMetrics — overdamped reference (ζ = 1.5)', () => {
	const samples = stepHistory((t) => overdampedStep(1.5, 2.0, t), 1.0, 25);
	const segments = computeStepResponseMetrics(samples);

	it('reports zero overshoot (settled without crossing)', () => {
		expect(segments[0].overshootPercent).toBe(0);
	});

	it('reports no oscillation and no decay ratio', () => {
		expect(segments[0].oscillationCount).toBe(0);
		expect(segments[0].decayRatio).toBeNull();
	});

	it('settles', () => {
		expect(segments[0].settleTimeSec).not.toBeNull();
	});
});

describe('computeStepResponseMetrics — pathological cases', () => {
	it('returns null overshoot when the output never approaches the target', () => {
		// Output stuck at 0 after a unit step: never crosses, never settles
		const samples = stepHistory(() => 0, 1.0, 10);
		const segments = computeStepResponseMetrics(samples);
		expect(segments[0].overshootPercent).toBeNull();
		expect(segments[0].settleTimeSec).toBeNull();
	});

	it('splits a history with two setpoint changes into two segments', () => {
		const samples: TelemetrySample[] = [];
		for (let k = 0; k <= 900; k++) {
			const t = k * DT; // 15 s total
			const setpoint = t < 5 ? 0 : t < 10 ? 1 : 0;
			// Instant tracker: y follows the setpoint exactly (zero overshoot)
			samples.push({ t, y: setpoint, v: 0, setpoint, error: 0, control: 0 });
		}
		const segments = computeStepResponseMetrics(samples);
		expect(segments.length).toBe(2);
		expect(segments[0].stepSize).toBe(1);
		expect(segments[1].stepSize).toBe(-1);
		expect(segments[0].overshootPercent).toBe(0);
		expect(segments[1].overshootPercent).toBe(0);
	});

	it('skips segments shorter than minSegmentSec', () => {
		const samples: TelemetrySample[] = [];
		for (let k = 0; k <= 600; k++) {
			const t = k * DT; // 10 s
			const setpoint = t < 9.5 ? 0 : 1; // step 0.5 s before the end
			samples.push({ t, y: 0, v: 0, setpoint, error: setpoint, control: 0 });
		}
		expect(computeStepResponseMetrics(samples).length).toBe(0);
	});

	it('returns an empty array for empty or tiny histories', () => {
		expect(computeStepResponseMetrics([])).toEqual([]);
		expect(
			computeStepResponseMetrics([{ t: 0, y: 0, v: 0, setpoint: 0, error: 0, control: 0 }])
		).toEqual([]);
	});
});

describe('summarizeStepMetrics', () => {
	it('averages over segments and takes the worst decay ratio', () => {
		const zeta02 = stepHistory((t) => underdampedStep(0.2, 2.0, t), 1.0, 25);
		const zeta05 = stepHistory((t) => underdampedStep(0.5, 2.0, t), 1.0, 25);
		const segments = [...computeStepResponseMetrics(zeta02), ...computeStepResponseMetrics(zeta05)];
		const summary = summarizeStepMetrics(segments);
		expect(summary.stepCount).toBe(2);
		const expectedMean =
			(100 * Math.exp((-Math.PI * 0.2) / Math.sqrt(1 - 0.04)) +
				100 * Math.exp((-Math.PI * 0.5) / Math.sqrt(1 - 0.25))) /
			2;
		expect(Math.abs(summary.meanOvershootPercent! - expectedMean)).toBeLessThan(1);
		// Worst decay ratio is the slower-decaying ζ = 0.2 segment
		const expectedWorst = Math.exp((-2 * Math.PI * 0.2) / Math.sqrt(1 - 0.04));
		expect(Math.abs(summary.worstDecayRatio! - expectedWorst)).toBeLessThan(expectedWorst * 0.02);
		expect(summary.meanSettleTimeSec).not.toBeNull();
	});

	it('handles an empty segment list', () => {
		const summary = summarizeStepMetrics([]);
		expect(summary.stepCount).toBe(0);
		expect(summary.meanOvershootPercent).toBeNull();
		expect(summary.meanOscillationCount).toBeNull();
		expect(summary.meanSettleTimeSec).toBeNull();
		expect(summary.worstDecayRatio).toBeNull();
	});
});

describe('saturationFraction', () => {
	function sampleWithControl(control: number, t: number): TelemetrySample {
		return { t, y: 5, v: 0, setpoint: 5, error: 0, control };
	}

	it('counts samples pinned at either limit', () => {
		const samples = [0, 5, 40, 20, 0].map((u, i) => sampleWithControl(u, i * DT));
		// 0, 40, 0 are at the [0, 40] limits → 3 of 5
		expect(saturationFraction(samples, 0, 40)).toBeCloseTo(3 / 5, 10);
	});

	it('respects symmetric lab limits', () => {
		const samples = [-9.81, -3, 0, 3, 9.81].map((u, i) => sampleWithControl(u, i * DT));
		expect(saturationFraction(samples, -9.81, 9.81)).toBeCloseTo(2 / 5, 10);
	});

	it('returns 0 for an empty history or an unsaturated signal', () => {
		expect(saturationFraction([], 0, 40)).toBe(0);
		const samples = [10, 20, 30].map((u, i) => sampleWithControl(u, i * DT));
		expect(saturationFraction(samples, 0, 40)).toBe(0);
	});
});
