/**
 * Pole-zero analysis for the linearised plant and PID closed-loop system.
 *
 * Plant (linearised at v₀ = 0):
 *   P(s) = 1 / (m · s²)
 *   Poles: s = 0 (double)    Zeros: none
 *
 * PID controller:
 *   C(s) = (K_d·s² + K_p·s + K_i) / s
 *   Poles: s = 0             Zeros: roots of K_d·s² + K_p·s + K_i = 0
 *
 * Open-loop L(s) = C(s)·P(s):
 *   Poles: s = 0 (triple)    Zeros: roots of K_d·s² + K_p·s + K_i = 0
 *
 * Closed-loop T(s) = L(s) / (1 + L(s)):
 *   Characteristic polynomial: m·s³ + K_d·s² + K_p·s + K_i = 0
 *   Zeros: roots of K_d·s² + K_p·s + K_i = 0
 *
 * Roots of the cubic characteristic polynomial are found using Durand–Kerner
 * (Weierstrass) iteration — a numerically robust simultaneous root-finding
 * method that does not require an initial bracket.
 *
 * Pure functions only. No side effects.
 */

import type { PhysicsParams } from '$lib/game/physics';
import { DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import type { PIDParams } from '$lib/control/pid-controller';
import { DEFAULT_PID_PARAMS } from '$lib/control/pid-controller';

export interface Complex {
	re: number;
	im: number;
}

export interface PoleZeroData {
	poles: Complex[];
	zeros: Complex[];
}

/** Add two complex numbers. */
function cAdd(a: Complex, b: Complex): Complex {
	return { re: a.re + b.re, im: a.im + b.im };
}

/** Subtract two complex numbers. */
function cSub(a: Complex, b: Complex): Complex {
	return { re: a.re - b.re, im: a.im - b.im };
}

/** Multiply two complex numbers. */
function cMul(a: Complex, b: Complex): Complex {
	return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** Divide complex a by complex b. */
function cDiv(a: Complex, b: Complex): Complex {
	const denom = b.re * b.re + b.im * b.im;
	if (denom === 0) return { re: NaN, im: NaN };
	return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

/** Evaluate a monic polynomial at complex point z using Horner's method.
 *  coeffs = [a_n, a_{n-1}, …, a_0] */
function polyEval(coeffs: number[], z: Complex): Complex {
	let result: Complex = { re: 0, im: 0 };
	for (const c of coeffs) {
		result = cAdd(cMul(result, z), { re: c, im: 0 });
	}
	return result;
}

/** Complex magnitude squared. */
function cAbsSq(z: Complex): number {
	return z.re * z.re + z.im * z.im;
}

/**
 * Find all roots of a polynomial using Durand–Kerner (Weierstrass) iteration.
 *
 * The polynomial is given as an array of coefficients [a_n, a_{n-1}, …, a_0]
 * where a_n is the leading coefficient (must be non-zero).
 *
 * Roots with imaginary part |im| < SNAP_EPS are snapped to real axis for cleaner display.
 *
 * @param coeffs - Polynomial coefficients, highest degree first
 * @param maxIter - Maximum iterations (default 200)
 * @returns Array of complex roots
 */
export function findRoots(coeffs: number[], maxIter = 200): Complex[] {
	const SNAP_EPS = 1e-9;

	// Strip leading zeros
	let start = 0;
	while (start < coeffs.length - 1 && coeffs[start] === 0) start++;
	const c = coeffs.slice(start);
	const n = c.length - 1; // degree

	if (n === 0) return [];
	if (n === 1) {
		// Linear: a*s + b = 0  →  s = -b/a
		return [{ re: -c[1] / c[0], im: 0 }];
	}

	// Normalise to monic
	const lead = c[0];
	const monic = c.map((v) => v / lead);

	// Initial guesses: evenly spaced on a circle of radius r = 1 + max|coeff_i/lead|
	const r = 1 + Math.max(...monic.slice(1).map(Math.abs));
	const roots: Complex[] = Array.from({ length: n }, (_, k) => ({
		re: r * Math.cos((2 * Math.PI * k) / n + 0.1),
		im: r * Math.sin((2 * Math.PI * k) / n + 0.1)
	}));

	for (let iter = 0; iter < maxIter; iter++) {
		let maxDelta = 0;
		for (let i = 0; i < n; i++) {
			const pz = polyEval(monic, roots[i]);
			// Product of (roots[i] - roots[j]) for j != i
			let denom: Complex = { re: 1, im: 0 };
			for (let j = 0; j < n; j++) {
				if (j !== i) denom = cMul(denom, cSub(roots[i], roots[j]));
			}
			const delta = cDiv(pz, denom);
			roots[i] = cSub(roots[i], delta);
			maxDelta = Math.max(maxDelta, cAbsSq(delta));
		}
		if (maxDelta < 1e-20) break;
	}

	// Snap near-real roots to the real axis
	return roots.map((r) => (Math.abs(r.im) < SNAP_EPS ? { re: r.re, im: 0 } : r));
}

/**
 * Find roots of a quadratic a·s² + b·s + c = 0 using the quadratic formula.
 * Returns exact complex roots without iterative approximation.
 */
function quadraticRoots(a: number, b: number, c: number): Complex[] {
	if (a === 0) {
		// Degenerate: b*s + c = 0
		if (b === 0) return [];
		return [{ re: -c / b, im: 0 }];
	}
	const discriminant = b * b - 4 * a * c;
	if (discriminant >= 0) {
		const sqrtD = Math.sqrt(discriminant);
		return [
			{ re: (-b + sqrtD) / (2 * a), im: 0 },
			{ re: (-b - sqrtD) / (2 * a), im: 0 }
		];
	}
	const sqrtAbsD = Math.sqrt(-discriminant);
	return [
		{ re: -b / (2 * a), im: sqrtAbsD / (2 * a) },
		{ re: -b / (2 * a), im: -sqrtAbsD / (2 * a) }
	];
}

/**
 * Compute poles and zeros of the linearised plant P(s) = 1/(m·s²).
 *
 * Poles: double at s = 0
 * Zeros: none
 */
export function computePlantPoleZero(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): PoleZeroData {
	// P(s) = 1 / (m·s²) — we don't use params.mass in the root positions,
	// the mass only scales the gain, not the pole/zero locations.
	void params; // params is accepted for API consistency; mass doesn't shift poles/zeros
	return {
		poles: [
			{ re: 0, im: 0 },
			{ re: 0, im: 0 }
		],
		zeros: []
	};
}

/**
 * Compute poles and zeros of the PID controller C(s) = (Kd·s² + Kp·s + Ki) / s.
 *
 * Poles: s = 0
 * Zeros: roots of Kd·s² + Kp·s + Ki = 0
 */
export function computePIDPoleZero(pid: PIDParams = DEFAULT_PID_PARAMS): PoleZeroData {
	const zeros = quadraticRoots(pid.kd, pid.kp, pid.ki);
	return {
		poles: [{ re: 0, im: 0 }],
		zeros
	};
}

/**
 * Compute poles and zeros of the open-loop L(s) = C(s)·P(s).
 *
 * L(s) = (Kd·s² + Kp·s + Ki) / (m·s³)
 *
 * Poles: triple at s = 0
 * Zeros: roots of Kd·s² + Kp·s + Ki = 0
 */
export function computeOpenLoopPoleZero(
	params: PhysicsParams = DEFAULT_PHYSICS_PARAMS,
	pid: PIDParams = DEFAULT_PID_PARAMS
): PoleZeroData {
	void params;
	const zeros = quadraticRoots(pid.kd, pid.kp, pid.ki);
	return {
		poles: [
			{ re: 0, im: 0 },
			{ re: 0, im: 0 },
			{ re: 0, im: 0 }
		],
		zeros
	};
}

/**
 * Compute poles and zeros of the closed-loop system T(s) = L(s)/(1+L(s)).
 *
 * Characteristic polynomial (denominator): m·s³ + Kd·s² + Kp·s + Ki
 * Zeros (numerator):                        Kd·s² + Kp·s + Ki
 *
 * Poles are found using Durand–Kerner root finding on the cubic.
 */
export function computeClosedLoopPoleZero(
	params: PhysicsParams = DEFAULT_PHYSICS_PARAMS,
	pid: PIDParams = DEFAULT_PID_PARAMS
): PoleZeroData {
	// Characteristic polynomial: m*s³ + Kd*s² + Kp*s + Ki
	const poles = findRoots([params.mass, pid.kd, pid.kp, pid.ki]);
	const zeros = quadraticRoots(pid.kd, pid.kp, pid.ki);
	return { poles, zeros };
}
