/**
 * Closed-loop step response — controller + plant, simulated two ways.
 *
 * `simulateClosedLoop` runs the EXACT game path: the shared `stepPhysics`
 * (gravity, quadratic drag, saturation, bounds) plus the actuator model that
 * maps controller output to plant thrust. What this returns is what the game
 * shows, by construction — no duplicated physics.
 *
 * `simulateLinearClosedLoop` runs the same controller against the linearised
 * plant the Bode / pole-zero views analyse: m·ÿ = u′ with no saturation, drag,
 * or position bounds. This is the "textbook" reference trace. Pass a
 * controller without output limits to keep the reference purely linear.
 *
 * Overlaying the two traces makes the theory-vs-game gap visible and
 * explainable: in lab actuator mode they nearly coincide; in arcade mode the
 * one-sided thrust and gravity bias pull them apart.
 *
 * Pure functions only. No side effects (controllers are reset internally).
 */

import { stepPhysics, DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';
import type { PhysicsParams, PhysicsState } from '$lib/game/physics';
import { createActuatorModel, defaultLabLimit, toPlantControl } from '$lib/game/actuator';
import type { ActuatorMode } from '$lib/game/actuator';
import type { Controller } from '$lib/control/interfaces';

export interface ClosedLoopPoint {
	/** Simulation time (s) */
	t: number;
	/** Vertical position (world units) */
	y: number;
	/** Vertical velocity (world units / s) */
	v: number;
	/** Controller output at t (deviation in lab mode, total thrust in arcade) */
	u: number;
	/** Reference the controller was tracking at t */
	setpoint: number;
}

export interface ClosedLoopConfig {
	/** Controller under test. Reset before the simulation starts. */
	controller: Controller;
	/** Actuator interpretation: 'arcade' (one-sided thrust) or 'lab' (symmetric) */
	actuatorMode: ActuatorMode;
	/** Time of the setpoint step (s) */
	stepTime: number;
	/** Setpoint before the step; also the initial bird altitude (world units) */
	initialSetpoint: number;
	/** Setpoint after the step (world units) */
	finalSetpoint: number;
	/** Simulation horizon (s) */
	durationSec: number;
	/** Fixed integration step (s) — use the game's 1/60 for exact runtime parity */
	dt: number;
	/** Base plant parameters. Default: DEFAULT_PHYSICS_PARAMS */
	params?: PhysicsParams;
	/** Symmetric deviation limit for lab mode (N). Default: m·g */
	labLimit?: number;
	/**
	 * Regulation time at the initial setpoint before t = 0 (s). Default: 0.
	 * Lab mode starts at equilibrium anyway, but the arcade loop needs time to
	 * converge from its initial free fall (the integral must wind up to m·g);
	 * without a warm-up the step response is buried in that start-up transient.
	 * Warm-up samples are not returned.
	 */
	warmupSec?: number;
}

export interface LinearClosedLoopConfig {
	/** Controller under test — pass one WITHOUT output limits for a pure linear trace */
	controller: Controller;
	/** Time of the setpoint step (s) */
	stepTime: number;
	/** Setpoint before the step; also the initial position */
	initialSetpoint: number;
	/** Setpoint after the step */
	finalSetpoint: number;
	/** Simulation horizon (s) */
	durationSec: number;
	/** Fixed integration step (s) */
	dt: number;
	/** Plant mass for m·ÿ = u′. Default: DEFAULT_PHYSICS_PARAMS.mass */
	mass?: number;
}

/**
 * Simulate the closed loop through the shared nonlinear plant and actuator
 * model — the game-truth trace.
 *
 * Per step (mirroring the game loop): the controller sees the state at time t,
 * its output goes through the actuator mapping, then physics advances by dt.
 */
export function simulateClosedLoop(config: ClosedLoopConfig): ClosedLoopPoint[] {
	const params = config.params ?? DEFAULT_PHYSICS_PARAMS;
	const labLimit = config.labLimit ?? defaultLabLimit(params);
	const actuator = createActuatorModel(config.actuatorMode, params, labLimit);

	config.controller.reset();

	let state: PhysicsState = { y: config.initialSetpoint, v: 0 };
	const result: ClosedLoopPoint[] = [];

	// Warm-up: regulate at the initial setpoint until start-up transients die
	const warmupSteps = Math.ceil((config.warmupSec ?? 0) / config.dt);
	for (let k = 0; k < warmupSteps; k++) {
		const { control } = config.controller.update({
			t: (k - warmupSteps) * config.dt,
			dt: config.dt,
			setpoint: config.initialSetpoint,
			measurement: state.y
		});
		state = stepPhysics(
			state,
			toPlantControl(actuator, control),
			0,
			actuator.physicsParams,
			config.dt
		);
	}

	const steps = Math.ceil(config.durationSec / config.dt);
	for (let k = 0; k <= steps; k++) {
		const t = k * config.dt;
		const setpoint = t < config.stepTime ? config.initialSetpoint : config.finalSetpoint;
		const { control } = config.controller.update({
			t,
			dt: config.dt,
			setpoint,
			measurement: state.y
		});
		result.push({ t, y: state.y, v: state.v, u: control, setpoint });
		if (k < steps) {
			state = stepPhysics(
				state,
				toPlantControl(actuator, control),
				0,
				actuator.physicsParams,
				config.dt
			);
		}
	}

	return result;
}

/**
 * Simulate the closed loop through the LINEARISED plant m·ÿ = u′ — the same
 * double-integrator model the Bode and pole-zero views analyse. No gravity
 * (absorbed by the operating point), no drag (zero slope at v₀ = 0), no
 * saturation, no position bounds.
 *
 * Integration is semi-implicit Euler with the same dt as the nonlinear
 * simulation, so differences between the traces come from the model, not the
 * integrator.
 */
export function simulateLinearClosedLoop(config: LinearClosedLoopConfig): ClosedLoopPoint[] {
	const mass = config.mass ?? DEFAULT_PHYSICS_PARAMS.mass;

	config.controller.reset();

	let y = config.initialSetpoint;
	let v = 0;
	const steps = Math.ceil(config.durationSec / config.dt);
	const result: ClosedLoopPoint[] = [];

	for (let k = 0; k <= steps; k++) {
		const t = k * config.dt;
		const setpoint = t < config.stepTime ? config.initialSetpoint : config.finalSetpoint;
		const { control } = config.controller.update({
			t,
			dt: config.dt,
			setpoint,
			measurement: y
		});
		result.push({ t, y, v, u: control, setpoint });
		if (k < steps) {
			v += (control / mass) * config.dt;
			y += v * config.dt;
		}
	}

	return result;
}
