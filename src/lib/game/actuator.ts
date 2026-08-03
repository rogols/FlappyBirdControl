/**
 * Actuator model — maps controller output to the thrust applied to the plant.
 *
 * Two actuator modes are offered, both realized by the SAME one-sided physical
 * thruster (u ∈ [0, uMax] N in `physics.ts`); they differ only in how the
 * controller's output is interpreted:
 *
 * - `arcade` (default game behaviour): the controller output IS the total
 *   thrust. The actuator is one-sided — the controller can push up but only
 *   gravity pulls down — so the closed-loop response is asymmetric and does
 *   not match the linear analysis model.
 *
 * - `lab`: the controller output is a *deviation* u′ around the hover
 *   equilibrium u_eq = m·g, clamped symmetrically to ±labLimit. The plant
 *   receives u = m·g + u′. Because drag is exactly zero at v = 0, this bias is
 *   the exact equilibrium shift, and the deviation loop e → C → u′ is
 *   precisely the loop analysed by the Bode / pole-zero / linear step-response
 *   views (P(s) = 1/(m·s²)). Textbook overshoot, oscillation, and convergence
 *   become directly observable.
 *
 * The physics saturation limits and the controller output clamp are BOTH
 * derived here from one number, so they can never disagree.
 *
 * Pure functions only. No side effects.
 */

import { DEFAULT_PHYSICS_PARAMS } from './physics.ts';
import type { PhysicsParams } from './physics.ts';

/** How the controller output is interpreted before reaching the plant. */
export type ActuatorMode = 'arcade' | 'lab';

export interface ActuatorModel {
	mode: ActuatorMode;
	/**
	 * Constant feedforward added to the controller output before the plant (N).
	 * 0 in arcade mode; m·g (exact hover equilibrium) in lab mode.
	 */
	feedforward: number;
	/** Minimum controller output (N): 0 in arcade, −labLimit in lab. */
	outputMin: number;
	/** Maximum controller output (N): uMax in arcade, +labLimit in lab. */
	outputMax: number;
	/**
	 * Physics parameters with uMin/uMax derived consistently from the
	 * controller clamp plus feedforward, so plant saturation and controller
	 * saturation coincide.
	 */
	physicsParams: PhysicsParams;
}

/**
 * Default symmetric deviation limit for lab mode (N).
 *
 * Chosen as m·g so total thrust spans [0, 2·m·g] ⊂ [0, uMax] — realizable by
 * the same one-sided thruster as arcade mode. Lab mode does not add a
 * downward rocket; it biases the same actuator at hover and uses the
 * symmetric headroom around it.
 */
export function defaultLabLimit(params: PhysicsParams = DEFAULT_PHYSICS_PARAMS): number {
	return params.mass * params.gravity;
}

/**
 * Build the actuator model for a mode.
 *
 * @param mode - Actuator interpretation mode
 * @param baseParams - Base plant parameters (arcade limits come from here)
 * @param labLimit - Symmetric deviation limit for lab mode (N). Must satisfy
 *                   0 < labLimit and m·g + labLimit ≤ baseParams.uMax so the
 *                   underlying one-sided thruster can realize every command.
 */
export function createActuatorModel(
	mode: ActuatorMode,
	baseParams: PhysicsParams = DEFAULT_PHYSICS_PARAMS,
	labLimit: number = defaultLabLimit(baseParams)
): ActuatorModel {
	if (mode === 'arcade') {
		return {
			mode,
			feedforward: 0,
			outputMin: baseParams.uMin,
			outputMax: baseParams.uMax,
			physicsParams: baseParams
		};
	}

	if (!(labLimit > 0) || !isFinite(labLimit)) {
		throw new Error(`labLimit must be a positive finite number, got ${labLimit}`);
	}

	const equilibrium = baseParams.mass * baseParams.gravity;
	const uMin = Math.max(equilibrium - labLimit, baseParams.uMin);
	const uMax = Math.min(equilibrium + labLimit, baseParams.uMax);

	return {
		mode,
		feedforward: equilibrium,
		outputMin: uMin - equilibrium,
		outputMax: uMax - equilibrium,
		physicsParams: { ...baseParams, uMin, uMax }
	};
}

/**
 * Map a controller output to the thrust command sent to the plant:
 * clamp to the controller output range, then add the feedforward.
 *
 * By construction the result always lies within
 * [physicsParams.uMin, physicsParams.uMax].
 */
export function toPlantControl(model: ActuatorModel, controllerOutput: number): number {
	const clamped = Math.min(Math.max(controllerOutput, model.outputMin), model.outputMax);
	return model.feedforward + clamped;
}

/**
 * Normalisation scale for control-effort displays: the largest controller
 * output magnitude the actuator accepts.
 */
export function controlEffortScale(model: ActuatorModel): number {
	return Math.max(Math.abs(model.outputMin), Math.abs(model.outputMax));
}
