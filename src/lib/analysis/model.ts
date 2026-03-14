/**
 * Analysis model — shared plant description and ODE display helpers.
 *
 * This module exposes the shared physics model in a form suitable for analysis
 * views: ODE display, equilibrium computation, and linearisation.
 *
 * It does NOT import game-only modules (rendering, engine, RNG); it only
 * re-exports from physics.ts and provides pure analysis helpers on top.
 *
 * Phase 2 implementation.
 */

// Re-export physics types so analysis views can reference the plant model
// without coupling to the game module directly.
export type { PhysicsParams, PhysicsState } from '$lib/game/physics';
export { DEFAULT_PHYSICS_PARAMS, stepPhysics, saturateControl } from '$lib/game/physics';

import { DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import type { PhysicsParams } from '$lib/game/physics';

/**
 * Human-readable description of each ODE term, keyed to the variable name.
 */
export const ODE_TERMS = {
	position: 'ẏ = v',
	momentum: 'm·v̇ = u − m·g − c_d·v|v| + d(t)'
} as const;

/**
 * Return a plain-text representation of the ODE system with parameter values
 * substituted, suitable for display in the analysis view.
 *
 * Example output:
 *   ẏ  = v
 *   1.0·v̇ = u − 1.0·9.81 − 0.5·v|v| + d(t)
 */
export function formatODE(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): {
	positionEq: string;
	momentumEq: string;
} {
	const { mass, gravity, dragCoeff } = params;
	return {
		positionEq: 'ẏ = v',
		momentumEq: `${mass}·v̇ = u − ${mass}·${gravity} − ${dragCoeff}·v|v| + d(t)`
	};
}

/**
 * Compute the control input required for vertical equilibrium (hover).
 *
 * At equilibrium: v = 0, so drag = 0.
 * Force balance: u_eq = m · g
 */
export function equilibriumControl(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): number {
	return params.mass * params.gravity;
}

/**
 * Linearised plant transfer function coefficients at v₀ = 0.
 *
 * P(s) = 1 / (m · s²)
 *
 * Returns numerator and denominator polynomial coefficients [highest power first].
 *   numerator:   [1]          → 1
 *   denominator: [m, 0, 0]   → m·s²
 */
export function plantTransferFunction(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): {
	numerator: number[];
	denominator: number[];
} {
	return {
		numerator: [1],
		denominator: [params.mass, 0, 0]
	};
}

/**
 * Metadata about the process model, formatted for display.
 */
export function getModelDescription(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): {
	title: string;
	ode: { positionEq: string; momentumEq: string };
	equilibriumControl: number;
	plantTF: { numerator: number[]; denominator: number[] };
	params: PhysicsParams;
} {
	return {
		title: 'Bird Vertical Dynamics (2nd-order ODE)',
		ode: formatODE(params),
		equilibriumControl: equilibriumControl(params),
		plantTF: plantTransferFunction(params),
		params
	};
}
