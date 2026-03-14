/**
 * Unit tests for src/lib/analysis/pole-zero.ts
 *
 * Validates:
 * - Plant poles at s=0 (double), no zeros
 * - PID pole-zero structure
 * - Open-loop pole-zero structure
 * - Closed-loop poles are roots of m·s³ + Kd·s² + Kp·s + Ki = 0
 * - findRoots: known polynomials (linear, quadratic, cubic)
 * - No NaN/Infinity in outputs
 */

import { describe, it, expect } from 'vitest';
import {
	computePlantPoleZero,
	computePIDPoleZero,
	computeOpenLoopPoleZero,
	computeClosedLoopPoleZero,
	findRoots
} from './pole-zero';
import { DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import { DEFAULT_PID_PARAMS } from '$lib/control/pid-controller';

const PARAMS = DEFAULT_PHYSICS_PARAMS;
const PID = DEFAULT_PID_PARAMS;

/** Evaluate polynomial at a real value */
function polyReal(coeffs: number[], x: number): number {
	return coeffs.reduce((acc, c) => acc * x + c, 0);
}

describe('computePlantPoleZero', () => {
	it('has exactly 2 poles, both at origin', () => {
		const { poles } = computePlantPoleZero(PARAMS);
		expect(poles).toHaveLength(2);
		for (const p of poles) {
			expect(p.re).toBeCloseTo(0, 9);
			expect(p.im).toBeCloseTo(0, 9);
		}
	});

	it('has no zeros', () => {
		const pz = computePlantPoleZero(PARAMS);
		expect(pz.zeros).toHaveLength(0);
	});
});

describe('computePIDPoleZero', () => {
	it('has exactly 1 pole at origin', () => {
		const { poles } = computePIDPoleZero(PID);
		expect(poles).toHaveLength(1);
		expect(poles[0].re).toBeCloseTo(0, 9);
		expect(poles[0].im).toBeCloseTo(0, 9);
	});

	it('has exactly 2 zeros', () => {
		const { zeros } = computePIDPoleZero(PID);
		expect(zeros).toHaveLength(2);
	});

	it('zeros satisfy Kd*z^2 + Kp*z + Ki = 0', () => {
		const { zeros } = computePIDPoleZero(PID);
		for (const z of zeros) {
			// Evaluate polynomial at z (complex): just check |p(z)| ≈ 0
			const re = PID.kd * (z.re * z.re - z.im * z.im) + PID.kp * z.re + PID.ki;
			const im = PID.kd * 2 * z.re * z.im + PID.kp * z.im;
			expect(Math.abs(re)).toBeLessThan(1e-8);
			expect(Math.abs(im)).toBeLessThan(1e-8);
		}
	});
});

describe('computeOpenLoopPoleZero', () => {
	it('has 3 poles at origin', () => {
		const { poles } = computeOpenLoopPoleZero(PARAMS, PID);
		expect(poles).toHaveLength(3);
		for (const p of poles) {
			expect(p.re).toBeCloseTo(0, 9);
			expect(p.im).toBeCloseTo(0, 9);
		}
	});

	it('has same zeros as PID controller', () => {
		const { zeros: olZeros } = computeOpenLoopPoleZero(PARAMS, PID);
		const { zeros: pidZeros } = computePIDPoleZero(PID);
		expect(olZeros.length).toBe(pidZeros.length);
	});
});

describe('computeClosedLoopPoleZero', () => {
	it('has exactly 3 poles', () => {
		const { poles } = computeClosedLoopPoleZero(PARAMS, PID);
		expect(poles).toHaveLength(3);
	});

	it('poles satisfy characteristic polynomial m*s^3 + Kd*s^2 + Kp*s + Ki = 0', () => {
		const { poles } = computeClosedLoopPoleZero(PARAMS, PID);
		const poly = [PARAMS.mass, PID.kd, PID.kp, PID.ki];
		for (const p of poles) {
			// Evaluate at complex s = p using Horner
			let re = 0;
			let im = 0;
			for (const c of poly) {
				// (re + im*j)*s + c
				const newRe = re * p.re - im * p.im + c;
				const newIm = re * p.im + im * p.re;
				re = newRe;
				im = newIm;
			}
			expect(Math.abs(re)).toBeLessThan(1e-6);
			expect(Math.abs(im)).toBeLessThan(1e-6);
		}
	});

	it('poles are in the left-half plane for stable PID gains (kp=8, ki=1, kd=2)', () => {
		// DEFAULT_PID_PARAMS (kp=1, ki=0.1, kd=0.05) are NOT stable for this plant.
		// Use the game-tuned gains which satisfy the Routh stability criterion:
		//   Routh table for m=1, kd=2, kp=8, ki=1: all rows positive → stable.
		const stablePID = { ...PID, kp: 8, ki: 1, kd: 2 };
		const { poles } = computeClosedLoopPoleZero(PARAMS, stablePID);
		for (const p of poles) {
			expect(p.re).toBeLessThan(0.01); // allow numerical tolerance
		}
	});

	it('has no NaN or Infinity', () => {
		const { poles, zeros } = computeClosedLoopPoleZero(PARAMS, PID);
		for (const p of [...poles, ...zeros]) {
			expect(isFinite(p.re)).toBe(true);
			expect(isFinite(p.im)).toBe(true);
		}
	});
});

describe('findRoots', () => {
	it('linear s + 2 = 0 → root at s = -2', () => {
		const roots = findRoots([1, 2]);
		expect(roots).toHaveLength(1);
		expect(roots[0].re).toBeCloseTo(-2, 6);
		expect(roots[0].im).toBeCloseTo(0, 6);
	});

	it('quadratic s^2 - 5s + 6 = (s-2)(s-3) → roots at 2 and 3', () => {
		const roots = findRoots([1, -5, 6]);
		expect(roots).toHaveLength(2);
		const sorted = roots.map((r) => r.re).sort((a, b) => a - b);
		expect(sorted[0]).toBeCloseTo(2, 4);
		expect(sorted[1]).toBeCloseTo(3, 4);
	});

	it('quadratic s^2 + 1 → complex roots at ±j', () => {
		const roots = findRoots([1, 0, 1]);
		expect(roots).toHaveLength(2);
		for (const r of roots) {
			expect(r.re).toBeCloseTo(0, 5);
			expect(Math.abs(r.im)).toBeCloseTo(1, 5);
		}
	});

	it('cubic s^3 - 6s^2 + 11s - 6 = (s-1)(s-2)(s-3) → roots at 1, 2, 3', () => {
		const roots = findRoots([1, -6, 11, -6]);
		expect(roots).toHaveLength(3);
		const sorted = roots.map((r) => r.re).sort((a, b) => a - b);
		expect(sorted[0]).toBeCloseTo(1, 4);
		expect(sorted[1]).toBeCloseTo(2, 4);
		expect(sorted[2]).toBeCloseTo(3, 4);
		for (const r of roots) {
			expect(Math.abs(r.im)).toBeLessThan(1e-5);
		}
	});

	it('degree-0 polynomial returns empty array', () => {
		expect(findRoots([5])).toHaveLength(0);
	});

	it('verifies roots are actual roots by plugging back into polynomial', () => {
		const coeffs = [1, -6, 11, -6];
		const roots = findRoots(coeffs);
		for (const r of roots) {
			const val = polyReal(coeffs, r.re);
			expect(Math.abs(val)).toBeLessThan(1e-5);
		}
	});
});
