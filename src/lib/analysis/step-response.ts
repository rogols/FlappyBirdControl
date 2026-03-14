/**
 * Step response computation for the bird plant model.
 *
 * Simulates the plant physics (no controller) from rest at mid-range,
 * applying a constant step control input u = stepAmplitude for the full
 * duration. Returns a time series of position and velocity.
 *
 * Uses the same `stepPhysics` function as the game runtime — single source
 * of truth for the plant model.
 *
 * Pure functions only. No side effects.
 */

import { stepPhysics, DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import type { PhysicsParams, PhysicsState } from '$lib/game/physics';

export interface StepResponsePoint {
	/** Simulation time (s) */
	t: number;
	/** Vertical position (world units) */
	y: number;
	/** Vertical velocity (world units / s) */
	v: number;
}

export interface StepResponseConfig {
	/** Step amplitude (N). Defaults to DEFAULT_PHYSICS_PARAMS.uMax / 2. */
	stepAmplitude: number;
	/** Simulation horizon (s). Default: 5 s. */
	durationSec: number;
	/** Fixed integration step (s). Default: 1/60 s. */
	dt: number;
	/** Initial state. Defaults to hovering at mid-range. */
	initialState?: PhysicsState;
	/** Physics parameters. Defaults to DEFAULT_PHYSICS_PARAMS. */
	params?: PhysicsParams;
}

export const DEFAULT_STEP_RESPONSE_CONFIG: StepResponseConfig = {
	stepAmplitude: DEFAULT_PHYSICS_PARAMS.uMax / 2,
	durationSec: 5,
	dt: 1 / 60
};

/**
 * Compute the open-loop step response of the plant.
 *
 * Applies a constant control input `stepAmplitude` from t=0 with zero
 * disturbance and returns sampled (t, y, v) tuples.
 *
 * @param config - Step response configuration
 * @returns Array of time-series data points
 */
export function computeStepResponse(config: Partial<StepResponseConfig> = {}): StepResponsePoint[] {
	const {
		stepAmplitude,
		durationSec,
		dt,
		initialState: initState,
		params: physParams
	} = { ...DEFAULT_STEP_RESPONSE_CONFIG, ...config };

	const params = physParams ?? DEFAULT_PHYSICS_PARAMS;
	const state: PhysicsState = initState ?? {
		y: (params.yMin + params.yMax) / 2,
		v: 0
	};

	const steps = Math.ceil(durationSec / dt);
	const result: StepResponsePoint[] = [];

	let current = { ...state };
	for (let k = 0; k <= steps; k++) {
		const t = k * dt;
		result.push({ t, y: current.y, v: current.v });
		if (k < steps) {
			current = stepPhysics(current, stepAmplitude, 0, params, dt);
		}
	}

	return result;
}

/**
 * Compute the equilibrium control input needed to maintain a constant altitude
 * (zero velocity, zero acceleration) for the given physics params.
 *
 * At equilibrium: u_eq = m * g (balances gravity exactly; drag is zero at v=0).
 */
export function computeEquilibriumControl(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): number {
	return params.mass * params.gravity;
}
