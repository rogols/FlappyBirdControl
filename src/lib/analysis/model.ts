/**
 * Analysis model — stub for Phase 0.
 *
 * This module will expose the shared physics model in a form suitable for analysis views:
 * ODE display, step response, Bode, and pole-zero plots.
 *
 * Phase 2 implementation target.
 */

// Re-export physics types so analysis views can reference the plant model
// without coupling to the game module directly.
export type { PhysicsParams, PhysicsState } from '$lib/game/physics';
export { DEFAULT_PHYSICS_PARAMS, stepPhysics, saturateControl } from '$lib/game/physics';
