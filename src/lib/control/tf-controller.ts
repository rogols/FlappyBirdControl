/**
 * Transfer Function Controller — runtime execution of a discretized C(s).
 *
 * Implements the `Controller` interface using a direct-form I difference equation
 * derived from the Tustin (bilinear) discretization of a user-supplied continuous-time
 * transfer function C(s) = N(s) / D(s).
 *
 * Input requirement:
 *   - C(s) must be proper: deg(N) ≤ deg(D).
 *   - The denominator must have a non-zero leading coefficient.
 *
 * The difference equation:
 *   u[k] = b[0]·e[k] + b[1]·e[k−1] + … + b[m]·e[k−m]
 *          − a[1]·u[k−1] − a[2]·u[k−2] − … − a[n]·u[k−n]
 *
 * where [b] is the normalized discrete numerator, [a] is the normalized discrete
 * denominator (a[0] = 1), and e = setpoint − measurement.
 *
 * Pure controller logic only. No rendering or side effects.
 */

import type { Controller } from './interfaces.ts';
import { tustinDiscretize } from './discretization.ts';

export interface TFControllerParams {
	/**
	 * Continuous-time numerator polynomial coefficients, highest power first.
	 * e.g. [2, 8] for 2s + 8.
	 */
	numerator: number[];
	/**
	 * Continuous-time denominator polynomial coefficients, highest power first.
	 * e.g. [0.05, 1] for 0.05s + 1.
	 * Must satisfy deg(denominator) ≥ deg(numerator).
	 */
	denominator: number[];
	/**
	 * Sample period (s) — must match the game engine's fixedDt.
	 * Default: 1/60 s.
	 */
	dt: number;
	/** Minimum control output (N) */
	outputMin: number;
	/** Maximum control output (N) */
	outputMax: number;
}

/**
 * Default: filtered PD controller C(s) = (2s + 8) / (0.05s + 1).
 *
 * Pedagogical rationale:
 *   - Numerator (2s + 8) = Kd·s + Kp with Kd=2, Kp=8 (same gains as game PID).
 *   - Denominator (0.05s + 1) is a first-order low-pass filter (τ=0.05 s) that
 *     makes the system proper and limits derivative amplification of noise.
 *   - Because the plant is a double integrator P(s) = 1/s², this PD controller
 *     achieves zero steady-state error to a step reference without an integrator.
 *   - Closed-loop characteristic polynomial: 0.05s³ + s² + 2s + 8 — all Routh
 *     coefficients positive → stable.
 */
export const DEFAULT_TF_PARAMS: TFControllerParams = {
	numerator: [2, 8],
	denominator: [0.05, 1],
	dt: 1 / 60,
	outputMin: 0,
	outputMax: 40
};

export class TFController implements Controller {
	private readonly params: TFControllerParams;

	/** Normalized discrete numerator  [b_0, b_1, …, b_n] */
	private b: number[] = [];
	/** Normalized discrete denominator [1, a_1, …, a_n]  (a[0] = 1 after normalization) */
	private a: number[] = [];

	/** Circular buffer: past error inputs e[k−1], e[k−2], … (length = n) */
	private eBuf: number[] = [];
	/** Circular buffer: past control outputs u[k−1], u[k−2], … (length = n) */
	private uBuf: number[] = [];

	/** Whether discretization has been performed (populated in constructor) */
	private ready = false;
	/** Error message from discretization, if any */
	private initError: string | null = null;

	constructor(params: TFControllerParams) {
		this.params = { ...params };
		this.discretize();
	}

	private discretize(): void {
		try {
			const { numerator, denominator, dt } = this.params;
			const { numerator: dn, denominator: dd } = tustinDiscretize(numerator, denominator, dt);

			// Normalize so a[0] = 1
			const a0 = dd[0];
			if (Math.abs(a0) < 1e-15) {
				this.initError = 'Discrete denominator leading coefficient is zero after Tustin transform.';
				return;
			}

			this.a = dd.map((c) => c / a0);
			const bRaw = dn.map((c) => c / a0);

			// Pad numerator with leading zeros to match denominator length (n+1 terms for order n)
			const targetLen = this.a.length;
			this.b =
				bRaw.length < targetLen ? new Array(targetLen - bRaw.length).fill(0).concat(bRaw) : bRaw;

			this.ready = true;
		} catch (err) {
			this.initError = err instanceof Error ? err.message : String(err);
		}
	}

	reset(): void {
		if (!this.ready) {
			this.eBuf = [];
			this.uBuf = [];
			return;
		}
		const n = this.a.length - 1; // controller order
		this.eBuf = new Array(n).fill(0);
		this.uBuf = new Array(n).fill(0);
	}

	update(input: { t: number; dt: number; setpoint: number; measurement: number }): {
		control: number;
		internals?: Record<string, number>;
	} {
		if (!this.ready) {
			// Discretization failed — output equilibrium to keep bird alive
			return { control: 0, internals: { error: 0, tfError: 1 } };
		}

		const e = input.setpoint - input.measurement;

		// Direct Form I difference equation:
		//   u[k] = b[0]·e[k] + b[1]·e[k−1] + … − a[1]·u[k−1] − …
		let u = this.b[0] * e;
		for (let j = 0; j < this.eBuf.length; j++) {
			u += this.b[j + 1] * this.eBuf[j];
		}
		for (let j = 0; j < this.uBuf.length; j++) {
			u -= this.a[j + 1] * this.uBuf[j];
		}

		// Saturate to actuator limits
		const uSat = Math.min(Math.max(u, this.params.outputMin), this.params.outputMax);

		// Update history (insert new at front, drop oldest from back)
		this.eBuf.unshift(e);
		if (this.eBuf.length > this.a.length - 1) this.eBuf.pop();

		this.uBuf.unshift(uSat);
		if (this.uBuf.length > this.a.length - 1) this.uBuf.pop();

		return {
			control: uSat,
			internals: { error: e, u_raw: u }
		};
	}

	/**
	 * Return the normalized discrete-time coefficients used at runtime.
	 * Useful for display in the analysis view.
	 */
	getDiscreteCoeffs(): { numerator: number[]; denominator: number[] } {
		return { numerator: [...this.b], denominator: [...this.a] };
	}

	/** Return initialization error if discretization failed, otherwise null. */
	getInitError(): string | null {
		return this.initError;
	}

	/** Whether the controller discretized successfully and is ready to use. */
	isReady(): boolean {
		return this.ready;
	}
}
