/**
 * Bird vertical dynamics — discrete 2nd-order ODE with semi-implicit Euler integration.
 *
 * Equations of motion:
 *   dy/dt = v
 *   m·dv/dt = u − mg − c_d·v|v| + d(t)
 *
 * This file is shared between the game runtime and analysis module.
 * Do not change without discussion — it is the single source of truth for plant physics.
 *
 * Pure functions only. No side effects.
 */

export interface PhysicsParams {
	/** Bird mass (kg) */
	mass: number;
	/** Gravitational acceleration (m/s²), positive downward */
	gravity: number;
	/** Aerodynamic drag coefficient (kg/m), in v|v| drag model */
	dragCoeff: number;
	/** Minimum actuator force (N) */
	uMin: number;
	/** Maximum actuator force (N) */
	uMax: number;
	/** Minimum allowed position (world units) */
	yMin: number;
	/** Maximum allowed position (world units) */
	yMax: number;
	/** Maximum allowed speed magnitude (world units / s) */
	vMax: number;
}

export interface PhysicsState {
	/** Vertical position (world units, upward positive) */
	y: number;
	/** Vertical velocity (world units / s, upward positive) */
	v: number;
}

/**
 * Default physics parameters suitable for a Flappy Bird-like game.
 * Gravity pulls downward (positive g, negative net when u=0).
 */
export const DEFAULT_PHYSICS_PARAMS: PhysicsParams = {
	mass: 1.0,
	gravity: 9.81,
	dragCoeff: 0.5,
	uMin: 0.0,
	uMax: 40.0,
	yMin: 0.0,
	yMax: 10.0,
	vMax: 20.0
};

/**
 * Saturate a control input to actuator limits.
 *
 * @param u - Raw control force (N)
 * @param params - Physics parameters containing uMin and uMax
 * @returns Clamped control force within [uMin, uMax]
 */
export function saturateControl(u: number, params: PhysicsParams): number {
	return Math.min(Math.max(u, params.uMin), params.uMax);
}

/**
 * Advance physics state by one fixed time step using semi-implicit Euler integration.
 *
 * Semi-implicit Euler:
 *   1. Compute acceleration from current state: a = (u_sat − mg − c_d·v|v| + d) / m
 *   2. Update velocity first: v_{k+1} = v_k + a·dt
 *   3. Update position using new velocity: y_{k+1} = y_k + v_{k+1}·dt
 *
 * This ordering gives better energy behaviour than explicit Euler for oscillatory systems.
 *
 * Position and velocity are clamped to physical bounds after integration to prevent
 * non-physical states (e.g. bird through floor or ceiling).
 *
 * @param state - Current physics state
 * @param u - Control force (N), will be saturated internally
 * @param disturbance - Additive disturbance force (N), e.g. wind gust
 * @param params - Physics parameters
 * @param dt - Fixed time step (s), must be positive
 * @returns New physics state after one time step
 */
export function stepPhysics(
	state: PhysicsState,
	u: number,
	disturbance: number,
	params: PhysicsParams,
	dt: number
): PhysicsState {
	const uSaturated = saturateControl(u, params);

	// Net force: thrust up − gravity down − aerodynamic drag + disturbance
	// Drag is proportional to v|v| (quadratic drag, sign preserving)
	const dragForce = params.dragCoeff * state.v * Math.abs(state.v);
	const netForce = uSaturated - params.mass * params.gravity - dragForce + disturbance;
	const acceleration = netForce / params.mass;

	// Semi-implicit Euler: update velocity first, then position with new velocity
	const newVelocity = state.v + acceleration * dt;
	const clampedVelocity = Math.min(Math.max(newVelocity, -params.vMax), params.vMax);

	const newPosition = state.y + clampedVelocity * dt;
	const clampedPosition = Math.min(Math.max(newPosition, params.yMin), params.yMax);

	// If position is clamped (hit floor/ceiling), zero out velocity in that direction
	let finalVelocity = clampedVelocity;
	if (newPosition <= params.yMin && clampedVelocity < 0) {
		finalVelocity = 0;
	} else if (newPosition >= params.yMax && clampedVelocity > 0) {
		finalVelocity = 0;
	}

	return {
		y: clampedPosition,
		v: finalVelocity
	};
}
