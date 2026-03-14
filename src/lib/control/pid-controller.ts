/**
 * PID controller with anti-windup (clamping) and derivative filter.
 *
 * Discrete-time PID using the trapezoidal (bilinear) integral approximation and
 * a first-order derivative filter to reject high-frequency noise.
 *
 * Anti-windup:
 *   Integral accumulation is frozen whenever the output is saturated AND the
 *   error would drive the integrator further into saturation (back-calculation clamping).
 *
 * Derivative filter:
 *   The derivative term is filtered with a first-order low-pass:
 *     d_k = filterCoeff * d_{k-1} + (1 - filterCoeff) * (error_k - error_{k-1}) / dt
 *
 * Pure controller logic — no rendering or side effects.
 */

import type { Controller } from './interfaces.ts';

export interface PIDParams {
	/** Proportional gain */
	kp: number;
	/** Integral gain */
	ki: number;
	/** Derivative gain */
	kd: number;
	/** Derivative filter coefficient in [0, 1). 0 = no filter, close to 1 = heavy filter */
	filterCoeff: number;
	/** Minimum control output (saturation) */
	outputMin: number;
	/** Maximum control output (saturation) */
	outputMax: number;
}

export const DEFAULT_PID_PARAMS: PIDParams = {
	kp: 1.0,
	ki: 0.1,
	kd: 0.05,
	filterCoeff: 0.7,
	outputMin: 0.0,
	outputMax: 40.0
};

interface PIDState {
	/** Accumulated integral term */
	integral: number;
	/** Filtered derivative term */
	filteredDerivative: number;
	/** Previous error (for derivative computation) */
	previousError: number;
	/** Whether the controller has received a first update (to avoid derivative kick) */
	initialized: boolean;
}

export class PIDController implements Controller {
	private params: PIDParams;
	private state: PIDState;

	constructor(params: Partial<PIDParams> = {}) {
		this.params = { ...DEFAULT_PID_PARAMS, ...params };
		this.state = this.freshState();
	}

	private freshState(): PIDState {
		return {
			integral: 0,
			filteredDerivative: 0,
			previousError: 0,
			initialized: false
		};
	}

	reset(initialState?: unknown): void {
		if (
			initialState !== null &&
			initialState !== undefined &&
			typeof initialState === 'object' &&
			'integral' in initialState &&
			typeof (initialState as { integral: unknown }).integral === 'number'
		) {
			const s = initialState as Partial<PIDState>;
			this.state = {
				integral: s.integral ?? 0,
				filteredDerivative: s.filteredDerivative ?? 0,
				previousError: s.previousError ?? 0,
				initialized: s.initialized ?? false
			};
		} else {
			this.state = this.freshState();
		}
	}

	update(input: { t: number; dt: number; setpoint: number; measurement: number }): {
		control: number;
		internals?: Record<string, number>;
	} {
		const error = input.setpoint - input.measurement;
		const { kp, ki, kd, filterCoeff, outputMin, outputMax } = this.params;

		// Proportional term
		const proportional = kp * error;

		// Derivative term with first-order low-pass filter
		// On the first call, skip derivative to avoid a derivative kick from step initialisation
		let derivative = 0;
		if (this.state.initialized && input.dt > 0) {
			const rawDerivative = (error - this.state.previousError) / input.dt;
			derivative = filterCoeff * this.state.filteredDerivative + (1 - filterCoeff) * rawDerivative;
		} else if (!this.state.initialized) {
			// First call: seed previous error, no derivative contribution
			derivative = 0;
		}

		// Unsaturated output (before integrating, to check saturation for anti-windup)
		const unsaturatedOutput = proportional + ki * this.state.integral + kd * derivative;
		const saturatedOutput = Math.min(Math.max(unsaturatedOutput, outputMin), outputMax);

		// Anti-windup: only integrate when not saturated, or when error pushes back toward setpoint
		const outputSaturated = saturatedOutput !== unsaturatedOutput;
		const integralWouldWorsen =
			(saturatedOutput >= outputMax && error > 0) || (saturatedOutput <= outputMin && error < 0);

		let newIntegral = this.state.integral;
		if (!(outputSaturated && integralWouldWorsen) && input.dt > 0) {
			newIntegral = this.state.integral + error * input.dt;
		}

		// Update state
		this.state = {
			integral: newIntegral,
			filteredDerivative: derivative,
			previousError: error,
			initialized: true
		};

		return {
			control: saturatedOutput,
			internals: {
				error,
				proportional,
				integral: ki * newIntegral,
				derivative: kd * derivative,
				rawIntegral: newIntegral,
				outputUnsaturated: unsaturatedOutput
			}
		};
	}
}
