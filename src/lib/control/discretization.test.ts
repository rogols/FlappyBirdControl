/**
 * Unit tests for src/lib/control/discretization.ts
 *
 * Validates:
 * - polyMul, polyAdd, polyScale, polyPow: basic polynomial arithmetic
 * - tustinDiscretize:
 *     Integrator 1/s    → T/2 · (z+1)/(z-1)
 *     Gain K            → K (unchanged)
 *     First-order lag   → known closed-form
 *     Throws on improper system
 * - normalizePoly: leading-coefficient normalisation and zero-stripping
 */

import { describe, it, expect } from 'vitest';
import {
	polyMul,
	polyAdd,
	polyScale,
	polyPow,
	tustinDiscretize,
	normalizePoly
} from './discretization';

// ── Polynomial helpers ────────────────────────────────────────────────────────

describe('polyMul', () => {
	it('(z+2)(3z+4) = 3z² + 10z + 8', () => {
		expect(polyMul([1, 2], [3, 4])).toEqual([3, 10, 8]);
	});

	it('empty input returns [0]', () => {
		expect(polyMul([], [1, 2])).toEqual([0]);
	});

	it('multiplying by [1] is identity', () => {
		expect(polyMul([3, -2, 1], [1])).toEqual([3, -2, 1]);
	});
});

describe('polyAdd', () => {
	it('(z+1) + (z−1) = 2z', () => {
		expect(polyAdd([1, 1], [1, -1])).toEqual([2, 0]);
	});

	it('handles different lengths: [1,2,3] + [4,5] = [1,6,8]', () => {
		expect(polyAdd([1, 2, 3], [4, 5])).toEqual([1, 6, 8]);
	});
});

describe('polyScale', () => {
	it('scales each coefficient', () => {
		expect(polyScale([1, -2, 3], 2)).toEqual([2, -4, 6]);
	});
});

describe('polyPow', () => {
	it('(z−1)^0 = 1', () => {
		expect(polyPow([1, -1], 0)).toEqual([1]);
	});

	it('(z−1)^1 = z − 1', () => {
		expect(polyPow([1, -1], 1)).toEqual([1, -1]);
	});

	it('(z−1)^2 = z² − 2z + 1', () => {
		expect(polyPow([1, -1], 2)).toEqual([1, -2, 1]);
	});

	it('(z+1)^3 = z³ + 3z² + 3z + 1', () => {
		expect(polyPow([1, 1], 3)).toEqual([1, 3, 3, 1]);
	});
});

// ── tustinDiscretize ──────────────────────────────────────────────────────────

describe('tustinDiscretize', () => {
	const T = 1 / 60;

	it('integrator 1/s → T/2 · (z+1)/(z−1)', () => {
		// C(s) = 1/s: numerator=[1], denominator=[1,0]
		const { numerator: n, denominator: d } = tustinDiscretize([1], [1, 0], T);
		// Expected: N_d = [1,1], D_d = [2/T, -2/T]
		// After normalising sign: D_d / (2/T) → [1, -1]; N_d / (2/T) → [T/2, T/2]
		const k = T / 2;
		expect(n[0] / d[0]).toBeCloseTo(k, 6); // N/D ratio at z=2 should match
		expect(n[1] / d[0]).toBeCloseTo(k, 6);
		expect(d[1] / d[0]).toBeCloseTo(-1, 6);
	});

	it('pure gain C(s)=K → C(z)=K at all frequencies', () => {
		const K = 5;
		const { numerator: n, denominator: d } = tustinDiscretize([K], [1], T);
		// C(s) = K / 1: deg 0, should stay K
		expect(n.length).toBe(1);
		expect(d.length).toBe(1);
		expect(n[0] / d[0]).toBeCloseTo(K, 6);
	});

	it('first-order lag 1/(s+1) → Tustin approximation', () => {
		// C(s) = 1/(s+1). Tustin with sample T:
		// After bilinear: C(z) = (T/2·(z+1)) / ((T/2+1)z + (T/2-1))
		// Normalised: numerator = [T/2, T/2], denominator = [T/2+1, T/2-1]
		const { numerator: n, denominator: d } = tustinDiscretize([1], [1, 1], T);
		const halfT = T / 2;
		const expectedDen0 = halfT + 1;
		const expectedDen1 = halfT - 1;
		const expectedNum0 = halfT;
		const expectedNum1 = halfT;
		// Scale ratio: n[0]/d[0] should match
		expect(n[0] / d[0]).toBeCloseTo(expectedNum0 / expectedDen0, 4);
		expect(n[1] / d[0]).toBeCloseTo(expectedNum1 / expectedDen0, 4);
		expect(d[1] / d[0]).toBeCloseTo(expectedDen1 / expectedDen0, 4);
	});

	it('filtered PD (default TF params) produces proper 2-element polynomials', () => {
		// C(s) = (2s+8)/(0.05s+1): biproper → both degree 1 → discrete is degree 1
		const { numerator: n, denominator: d } = tustinDiscretize([2, 8], [0.05, 1], T);
		expect(n.length).toBe(2);
		expect(d.length).toBe(2);
		expect(isFinite(n[0])).toBe(true);
		expect(isFinite(d[0])).toBe(true);
	});

	it('throws for improper system (deg(N) > deg(D))', () => {
		expect(() => tustinDiscretize([1, 2, 3], [1, 0], T)).toThrow(/improper/i);
	});

	it('throws for dt ≤ 0', () => {
		expect(() => tustinDiscretize([1], [1, 0], 0)).toThrow(/dt must be positive/i);
	});

	it('output is finite for all default params at T=1/60', () => {
		const { numerator: n, denominator: d } = tustinDiscretize([2, 8], [0.05, 1], T);
		for (const c of [...n, ...d]) {
			expect(isFinite(c)).toBe(true);
		}
	});

	it('bilinear maps integrator frequency response: |C(e^jωT)| ≈ 1/(ω) at ω=1 rad/s', () => {
		// For large T (≈ ω·T ≪ 1), Tustin integrator ≈ 1/s
		// At ω=1, |1/s| = 1/1 = 1. Use small T for accuracy.
		const smallT = 0.001;
		const { numerator: n, denominator: d } = tustinDiscretize([1], [1, 0], smallT);
		// Evaluate at z = e^{jω T} = e^{j·0.001} ≈ 1 + j·0.001
		const omega = 1;
		const zRe = Math.cos(omega * smallT);
		const zIm = Math.sin(omega * smallT);
		// Evaluate numerator and denominator at z
		function evalPoly(p: number[], re: number, im: number): [number, number] {
			let resRe = 0,
				resIm = 0;
			for (const c of p) {
				const newRe = resRe * re - resIm * im + c;
				const newIm = resRe * im + resIm * re;
				resRe = newRe;
				resIm = newIm;
			}
			return [resRe, resIm];
		}
		const [nRe, nIm] = evalPoly(n, zRe, zIm);
		const [dRe, dIm] = evalPoly(d, zRe, zIm);
		// |C| = |N|/|D|
		const mag = Math.sqrt(nRe ** 2 + nIm ** 2) / Math.sqrt(dRe ** 2 + dIm ** 2);
		// Should be close to 1/(omega) = 1
		expect(mag).toBeCloseTo(1 / omega, 2);
	});
});

// ── normalizePoly ─────────────────────────────────────────────────────────────

describe('normalizePoly', () => {
	it('divides by leading coefficient', () => {
		const result = normalizePoly([2, 4, -6]);
		expect(result[0]).toBeCloseTo(1, 9);
		expect(result[1]).toBeCloseTo(2, 9);
		expect(result[2]).toBeCloseTo(-3, 9);
	});

	it('strips near-zero leading terms', () => {
		const result = normalizePoly([1e-15, 2, 1], 1e-12);
		expect(result).toHaveLength(2);
		expect(result[0]).toBeCloseTo(1, 6);
	});

	it('single coefficient returns [1]', () => {
		expect(normalizePoly([5])).toEqual([1]);
	});
});
