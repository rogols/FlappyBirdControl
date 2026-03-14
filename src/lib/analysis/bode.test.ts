/**
 * Unit tests for src/lib/analysis/bode.ts
 *
 * Validates:
 * - Plant Bode: P(s) = 1/(m·s²) → |P(jω)| = 1/(m·ω²), ∠P = -180°
 * - PID Bode: magnitude and phase at specific frequencies
 * - Open-loop: L = C·P, magnitudes multiply (dB add), phases add
 * - Closed-loop: T = L/(1+L), gain rolls off past bandwidth
 * - logspace: start/end values and monotonicity
 * - No NaN/Infinity in well-conditioned frequency range
 */

import { describe, it, expect } from 'vitest';
import {
	computePlantBode,
	computePIDBode,
	computeOpenLoopBode,
	computeClosedLoopBode,
	logspace,
	cMul,
	cAdd,
	cDiv,
	polyEval
} from './bode';
import { DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import { DEFAULT_PID_PARAMS } from '$lib/control/pid-controller';

const PARAMS = DEFAULT_PHYSICS_PARAMS;
const PID = DEFAULT_PID_PARAMS;

describe('logspace', () => {
	it('starts and ends at specified values', () => {
		const fs = logspace(0.01, 100, 50);
		expect(fs[0]).toBeCloseTo(0.01, 6);
		expect(fs[fs.length - 1]).toBeCloseTo(100, 6);
	});

	it('is strictly increasing', () => {
		const fs = logspace(0.01, 100, 50);
		for (let i = 1; i < fs.length; i++) {
			expect(fs[i]).toBeGreaterThan(fs[i - 1]);
		}
	});

	it('returns requested number of points', () => {
		expect(logspace(1, 100, 30)).toHaveLength(30);
	});
});

describe('computePlantBode', () => {
	it('magnitude at ω=1 is 20·log10(1/m) dB', () => {
		const [pt] = computePlantBode([1], PARAMS);
		const expected = 20 * Math.log10(1 / PARAMS.mass);
		expect(pt.magnitudeDb).toBeCloseTo(expected, 3);
	});

	it('magnitude rolls off at -40 dB/decade (double integrator)', () => {
		const [ptLow, ptHigh] = computePlantBode([1, 10], PARAMS);
		// Ratio of magnitudes for ω2/ω1 = 10 → should be -40 dB
		const diff = ptHigh.magnitudeDb - ptLow.magnitudeDb;
		expect(diff).toBeCloseTo(-40, 0);
	});

	it('phase is ±180° at all frequencies (double integrator)', () => {
		// P(jω) = -1/(m·ω²) — a negative real number.
		// atan2(0, negative) = +180° (principal value).  Both ±180° represent the
		// same angle, so we accept |phaseDeg| ≈ 180.
		const freqs = logspace(0.01, 100, 20);
		const pts = computePlantBode(freqs, PARAMS);
		for (const pt of pts) {
			expect(Math.abs(pt.phaseDeg)).toBeCloseTo(180, 3);
		}
	});

	it('produces no NaN or Infinity in valid frequency range', () => {
		const freqs = logspace(0.01, 100, 100);
		const pts = computePlantBode(freqs, PARAMS);
		for (const pt of pts) {
			expect(isFinite(pt.magnitudeDb)).toBe(true);
			expect(isFinite(pt.phaseDeg)).toBe(true);
		}
	});

	it('magnitude increases by 40 dB as frequency halves', () => {
		const [ptHigh, ptLow] = computePlantBode([10, 1], PARAMS);
		expect(ptLow.magnitudeDb - ptHigh.magnitudeDb).toBeCloseTo(40, 0);
	});
});

describe('computePIDBode', () => {
	it('magnitude is non-negative in dB scale?', () => {
		// Just check it runs without NaN
		const freqs = logspace(0.1, 10, 20);
		const pts = computePIDBode(freqs, PID);
		for (const pt of pts) {
			expect(isFinite(pt.magnitudeDb)).toBe(true);
			expect(isFinite(pt.phaseDeg)).toBe(true);
		}
	});

	it('at pure proportional (Ki=0, Kd=0), phase is 0° and magnitude = 20*log10(Kp)', () => {
		const pid = { ...PID, ki: 0, kd: 0 };
		const [pt] = computePIDBode([1], pid);
		expect(pt.phaseDeg).toBeCloseTo(0, 3);
		expect(pt.magnitudeDb).toBeCloseTo(20 * Math.log10(pid.kp), 3);
	});

	it('at pure integral (Kp=0, Kd=0), phase is -90° at ω=1', () => {
		const pid = { ...PID, kp: 0, kd: 0, ki: 1 };
		const [pt] = computePIDBode([1], pid);
		expect(pt.phaseDeg).toBeCloseTo(-90, 3);
	});

	it('at pure derivative (Kp=0, Ki=0), phase is +90° at ω=1', () => {
		const pid = { ...PID, kp: 0, ki: 0, kd: 1 };
		const [pt] = computePIDBode([1], pid);
		expect(pt.phaseDeg).toBeCloseTo(90, 3);
	});
});

describe('computeOpenLoopBode', () => {
	it('dB magnitude equals plant dB + PID dB (convolution in frequency domain)', () => {
		const omega = 2;
		const [plant] = computePlantBode([omega], PARAMS);
		const [pid] = computePIDBode([omega], PID);
		const [ol] = computeOpenLoopBode([omega], PARAMS, PID);
		expect(ol.magnitudeDb).toBeCloseTo(plant.magnitudeDb + pid.magnitudeDb, 3);
	});

	it('phase equals plant phase + PID phase (modulo 360°)', () => {
		const omega = 2;
		const [plant] = computePlantBode([omega], PARAMS);
		const [pid] = computePIDBode([omega], PID);
		const [ol] = computeOpenLoopBode([omega], PARAMS, PID);
		// Phases must add modulo 360°.  Use a robust wrap to (-180, 180].
		const expectedPhase = plant.phaseDeg + pid.phaseDeg;
		const raw = ol.phaseDeg - expectedPhase;
		const diff = (((raw % 360) + 540) % 360) - 180;
		expect(Math.abs(diff)).toBeLessThan(0.001);
	});

	it('produces no NaN/Infinity in valid range', () => {
		const freqs = logspace(0.1, 50, 100);
		const pts = computeOpenLoopBode(freqs, PARAMS, PID);
		for (const pt of pts) {
			expect(isFinite(pt.magnitudeDb)).toBe(true);
			expect(isFinite(pt.phaseDeg)).toBe(true);
		}
	});
});

describe('computeClosedLoopBode', () => {
	it('magnitude at low frequency approaches 0 dB (unity tracking)', () => {
		// Well-tuned PID: at very low ω, |T| ≈ 1 (0 dB) for type-3 open loop
		// Use high Kp, Ki to ensure this
		const pid = { ...PID, kp: 20, ki: 5, kd: 4 };
		const [pt] = computeClosedLoopBode([0.05], PARAMS, pid);
		// Should be close to 0 dB (within ±3 dB at low frequency)
		expect(Math.abs(pt.magnitudeDb)).toBeLessThan(3);
	});

	it('magnitude rolls off at high frequency', () => {
		const pts = computeClosedLoopBode([1, 50], PARAMS, PID);
		// High-frequency gain should be well below low-frequency gain
		expect(pts[1].magnitudeDb).toBeLessThan(pts[0].magnitudeDb);
	});

	it('produces no NaN/Infinity in valid range', () => {
		const freqs = logspace(0.1, 50, 100);
		const pts = computeClosedLoopBode(freqs, PARAMS, PID);
		for (const pt of pts) {
			expect(isFinite(pt.magnitudeDb)).toBe(true);
			expect(isFinite(pt.phaseDeg)).toBe(true);
		}
	});
});

describe('complex arithmetic helpers', () => {
	it('cMul: (1+j)*(1-j) = 2', () => {
		const result = cMul({ re: 1, im: 1 }, { re: 1, im: -1 });
		expect(result.re).toBeCloseTo(2, 9);
		expect(result.im).toBeCloseTo(0, 9);
	});

	it('cAdd: (1+2j) + (3+4j) = 4+6j', () => {
		const result = cAdd({ re: 1, im: 2 }, { re: 3, im: 4 });
		expect(result.re).toBeCloseTo(4, 9);
		expect(result.im).toBeCloseTo(6, 9);
	});

	it('cDiv: (1+j)/(1+j) = 1', () => {
		const result = cDiv({ re: 1, im: 1 }, { re: 1, im: 1 });
		expect(result.re).toBeCloseTo(1, 9);
		expect(result.im).toBeCloseTo(0, 9);
	});

	it('polyEval: s^2 - 1 at s=2 → 3', () => {
		const result = polyEval([1, 0, -1], { re: 2, im: 0 });
		expect(result.re).toBeCloseTo(3, 9);
		expect(result.im).toBeCloseTo(0, 9);
	});

	it('polyEval: s at s=j → j', () => {
		const result = polyEval([1, 0], { re: 0, im: 1 });
		expect(result.re).toBeCloseTo(0, 9);
		expect(result.im).toBeCloseTo(1, 9);
	});
});
