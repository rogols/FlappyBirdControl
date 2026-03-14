/**
 * Bode plot computation for the linearised plant and open-loop transfer functions.
 *
 * Linearisation around equilibrium (v₀ = 0, u₀ = m·g):
 *   Δẏ  = Δv
 *   m·Δv̇ = Δu − c_d·2·|v₀|·Δv = Δu   (drag linearises to 0 at v₀ = 0)
 *
 * Linearised plant transfer function:
 *   P(s) = ΔY(s) / ΔU(s) = 1 / (m · s²)   [double integrator]
 *
 * PID controller transfer function:
 *   C(s) = K_p + K_i/s + K_d·s
 *        = (K_d·s² + K_p·s + K_i) / s
 *
 * Open-loop transfer function:
 *   L(s) = C(s) · P(s) = (K_d·s² + K_p·s + K_i) / (m · s³)
 *
 * All computations are in the continuous-time frequency domain (rad/s).
 *
 * Pure functions only. No side effects.
 */

import type { PhysicsParams } from '$lib/game/physics';
import { DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import type { PIDParams } from '$lib/control/pid-controller';
import { DEFAULT_PID_PARAMS } from '$lib/control/pid-controller';

export interface BodePoint {
	/** Frequency (rad/s) */
	freq: number;
	/** Magnitude (dB): 20·log₁₀(|H(jω)|) */
	magnitudeDb: number;
	/** Phase (degrees): ∠H(jω) × (180/π) */
	phaseDeg: number;
}

/** A complex number (real + imaginary parts). */
interface Complex {
	re: number;
	im: number;
}

/** Multiply two complex numbers. */
function cMul(a: Complex, b: Complex): Complex {
	return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** Add two complex numbers. */
function cAdd(a: Complex, b: Complex): Complex {
	return { re: a.re + b.re, im: a.im + b.im };
}

/** Divide complex a by complex b. Returns {re:NaN, im:NaN} when |b|=0. */
function cDiv(a: Complex, b: Complex): Complex {
	const denom = b.re * b.re + b.im * b.im;
	if (denom === 0) return { re: NaN, im: NaN };
	return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

/** Evaluate a polynomial with coefficients [a_n, a_{n-1}, …, a_0] at complex s using Horner's method. */
function polyEval(coeffs: number[], s: Complex): Complex {
	let result: Complex = { re: 0, im: 0 };
	for (const c of coeffs) {
		result = cAdd(cMul(result, s), { re: c, im: 0 });
	}
	return result;
}

/**
 * Evaluate the linearised plant transfer function P(s) = 1 / (m · s²) at s = jω.
 */
function plantFreqResponse(omega: number, params: PhysicsParams): Complex {
	// s = jω  →  s² = (jω)² = -ω²
	// P(jω) = 1 / (m · (-ω²)) = -1 / (m · ω²)
	// Real-valued — phase is -180°
	const denom = params.mass * omega * omega;
	if (denom === 0) return { re: NaN, im: NaN };
	return { re: -1 / denom, im: 0 };
}

/**
 * Evaluate the PID controller transfer function C(s) = Kp + Ki/s + Kd·s at s = jω.
 *
 * Note: This is the ideal (non-filtered) PID for frequency-domain analysis.
 * The derivative filter used in the runtime does not materially affect the
 * Bode plot at frequencies well below the filter cut-off.
 *
 * C(jω) = Kp + Ki/(jω) + Kd·(jω)
 *        = Kp  +  (-j · Ki/ω)  +  j · Kd·ω
 *        = Kp  +  j · (Kd·ω − Ki/ω)
 */
function pidFreqResponse(omega: number, pid: PIDParams): Complex {
	if (omega === 0) return { re: NaN, im: NaN };
	return { re: pid.kp, im: pid.kd * omega - pid.ki / omega };
}

/**
 * Convert a complex number to magnitude in dB and phase in degrees.
 */
function toDbAndDeg(c: Complex): { magnitudeDb: number; phaseDeg: number } {
	const mag = Math.sqrt(c.re * c.re + c.im * c.im);
	const magnitudeDb = 20 * Math.log10(mag);
	const phaseDeg = (Math.atan2(c.im, c.re) * 180) / Math.PI;
	return { magnitudeDb, phaseDeg };
}

/**
 * Generate a logarithmically-spaced array of frequencies.
 *
 * @param freqMin - Minimum frequency (rad/s)
 * @param freqMax - Maximum frequency (rad/s)
 * @param points  - Number of points (inclusive)
 */
export function logspace(freqMin: number, freqMax: number, points: number): number[] {
	if (points < 2) return [freqMin];
	const logMin = Math.log10(freqMin);
	const logMax = Math.log10(freqMax);
	return Array.from({ length: points }, (_, i) => {
		const logF = logMin + (i / (points - 1)) * (logMax - logMin);
		return Math.pow(10, logF);
	});
}

/**
 * Compute the Bode plot for the linearised plant P(s) = 1/(m·s²).
 *
 * @param frequencies - Array of frequencies (rad/s) at which to evaluate
 * @param params      - Physics parameters (uses mass field)
 */
export function computePlantBode(
	frequencies: number[],
	params: PhysicsParams = DEFAULT_PHYSICS_PARAMS
): BodePoint[] {
	return frequencies.map((omega) => {
		const H = plantFreqResponse(omega, params);
		const { magnitudeDb, phaseDeg } = toDbAndDeg(H);
		return { freq: omega, magnitudeDb, phaseDeg };
	});
}

/**
 * Compute the Bode plot for the PID controller C(s) alone.
 *
 * @param frequencies - Array of frequencies (rad/s)
 * @param pid         - PID parameters
 */
export function computePIDBode(
	frequencies: number[],
	pid: PIDParams = DEFAULT_PID_PARAMS
): BodePoint[] {
	return frequencies.map((omega) => {
		const H = pidFreqResponse(omega, pid);
		const { magnitudeDb, phaseDeg } = toDbAndDeg(H);
		return { freq: omega, magnitudeDb, phaseDeg };
	});
}

/**
 * Compute the Bode plot for the open-loop transfer function L(s) = C(s)·P(s).
 *
 * Multiplies frequency responses: L(jω) = C(jω) · P(jω).
 *
 * @param frequencies - Array of frequencies (rad/s)
 * @param params      - Physics parameters
 * @param pid         - PID parameters
 */
export function computeOpenLoopBode(
	frequencies: number[],
	params: PhysicsParams = DEFAULT_PHYSICS_PARAMS,
	pid: PIDParams = DEFAULT_PID_PARAMS
): BodePoint[] {
	return frequencies.map((omega) => {
		const P = plantFreqResponse(omega, params);
		const C = pidFreqResponse(omega, pid);
		const L = cMul(C, P);
		const { magnitudeDb, phaseDeg } = toDbAndDeg(L);
		return { freq: omega, magnitudeDb, phaseDeg };
	});
}

/**
 * Compute the Bode plot for the closed-loop transfer function:
 *   T(s) = L(s) / (1 + L(s))
 *
 * @param frequencies - Array of frequencies (rad/s)
 * @param params      - Physics parameters
 * @param pid         - PID parameters
 */
export function computeClosedLoopBode(
	frequencies: number[],
	params: PhysicsParams = DEFAULT_PHYSICS_PARAMS,
	pid: PIDParams = DEFAULT_PID_PARAMS
): BodePoint[] {
	return frequencies.map((omega) => {
		const P = plantFreqResponse(omega, params);
		const C = pidFreqResponse(omega, pid);
		const L = cMul(C, P);
		const one: Complex = { re: 1, im: 0 };
		const T = cDiv(L, cAdd(one, L));
		const { magnitudeDb, phaseDeg } = toDbAndDeg(T);
		return { freq: omega, magnitudeDb, phaseDeg };
	});
}

// Re-export helpers used in tests
export { polyEval, cMul, cAdd, cDiv };
export type { Complex };
