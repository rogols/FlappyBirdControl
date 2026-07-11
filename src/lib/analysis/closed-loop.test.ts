/**
 * Unit tests for src/lib/analysis/closed-loop.ts
 *
 * Validates:
 * - Anti-drift contract (FBC-302): simulateClosedLoop reproduces a GameEngine
 *   run exactly — same physics, same actuator mapping, same stepping order.
 * - Linear simulation against analytical control theory: P-only control of a
 *   double integrator gives 100% overshoot and oscillation at ωₙ = √(Kp/m).
 * - Lab-mode scenario: the default game PID shows textbook overshoot inside
 *   the range predicted by the linear analysis.
 * - Arcade-vs-lab pedagogy: arcade up/down steps are asymmetric, lab steps
 *   are symmetric.
 * - Numeric robustness: no NaN/Infinity anywhere in the traces.
 */

import { describe, it, expect } from 'vitest';
import { simulateClosedLoop, simulateLinearClosedLoop } from './closed-loop';
import type { ClosedLoopPoint } from './closed-loop';
import { GameEngine } from '$lib/game/engine';
import { createActuatorModel, toPlantControl } from '$lib/game/actuator';
import { PIDController } from '$lib/control/pid-controller';
import { OnOffController } from '$lib/control/onoff-controller';
import { computeStepResponseMetrics } from '$lib/telemetry/metrics';
import type { TelemetrySample } from '$lib/telemetry/recorder';
import { GAME_PID_GAINS } from '$lib/ui/controller-defaults';

const DT = 1 / 60;

/** Default game PID clamped to the given actuator's output range. */
function gamePid(actuator: { outputMin: number; outputMax: number }): PIDController {
	return new PIDController({
		...GAME_PID_GAINS,
		outputMin: actuator.outputMin,
		outputMax: actuator.outputMax
	});
}

/** Convert a closed-loop trace to telemetry samples for metric extraction. */
function toSamples(points: ClosedLoopPoint[]): TelemetrySample[] {
	return points.map((p) => ({
		t: p.t,
		y: p.y,
		v: p.v,
		setpoint: p.setpoint,
		error: p.setpoint - p.y,
		control: p.u
	}));
}

function expectAllFinite(points: ClosedLoopPoint[]): void {
	for (const p of points) {
		expect(Number.isFinite(p.y)).toBe(true);
		expect(Number.isFinite(p.v)).toBe(true);
		expect(Number.isFinite(p.u)).toBe(true);
	}
}

describe('simulateClosedLoop — anti-drift contract with the game runtime', () => {
	it('reproduces a GameEngine lab run exactly (|Δy| < 1e-9 at every step)', () => {
		// stepTime is placed between sample instants so float accumulation of
		// engine time vs k·dt cannot flip the switching step.
		const stepTime = 1.0 - DT / 2;
		const initialSetpoint = 5.0; // matches the engine's initial bird altitude
		const finalSetpoint = 6.0;
		const durationSec = 6;
		const actuator = createActuatorModel('lab');

		const simPid = gamePid(actuator);
		const trace = simulateClosedLoop({
			controller: simPid,
			actuatorMode: 'lab',
			stepTime,
			initialSetpoint,
			finalSetpoint,
			durationSec,
			dt: DT
		});

		const enginePid = gamePid(actuator);
		enginePid.reset();
		const engine = new GameEngine({
			seed: 42,
			spawnObstacles: false,
			physicsParams: actuator.physicsParams
		});
		engine.start();

		const steps = Math.ceil(durationSec / DT);
		for (let k = 0; k < steps; k++) {
			const state = engine.getState();
			const t = state.time;
			const setpoint = t < stepTime ? initialSetpoint : finalSetpoint;
			const { control } = enginePid.update({
				t,
				dt: DT,
				setpoint,
				measurement: state.physics.y
			});
			expect(Math.abs(trace[k].y - state.physics.y)).toBeLessThan(1e-9);
			expect(Math.abs(trace[k].u - control)).toBeLessThan(1e-9);
			engine.setControl(toPlantControl(actuator, control));
			engine.tick(DT);
		}
		expect(Math.abs(trace[steps].y - engine.getState().physics.y)).toBeLessThan(1e-9);
	});
});

describe('simulateLinearClosedLoop — analytical reference (P-only on 1/(m·s²))', () => {
	// P-only proportional control of a double integrator: undamped oscillation
	// at ωₙ = √(Kp/m) with 100% overshoot and no settling.
	const kp = 8;
	const omegaN = Math.sqrt(kp); // m = 1
	const stepTime = 1.0 - DT / 2;
	const trace = simulateLinearClosedLoop({
		controller: new PIDController({
			kp,
			ki: 0,
			kd: 0,
			filterCoeff: 0,
			outputMin: -1e9,
			outputMax: 1e9
		}),
		stepTime,
		initialSetpoint: 0,
		finalSetpoint: 1,
		durationSec: 12,
		dt: DT
	});

	it('overshoots by 100% within 1%', () => {
		const segments = computeStepResponseMetrics(toSamples(trace));
		expect(segments.length).toBe(1);
		expect(segments[0].overshootPercent).not.toBeNull();
		expect(Math.abs(segments[0].overshootPercent! - 100)).toBeLessThan(1);
	});

	it('oscillates at the predicted natural frequency within 2%', () => {
		// Measure two full periods from interpolated zero crossings of y − 1
		const crossings: number[] = [];
		for (let k = 1; k < trace.length; k++) {
			const e0 = trace[k - 1].y - 1;
			const e1 = trace[k].y - 1;
			if (trace[k - 1].t >= stepTime && e0 !== 0 && Math.sign(e0) !== Math.sign(e1)) {
				const frac = e0 / (e0 - e1);
				crossings.push(trace[k - 1].t + frac * DT);
			}
		}
		expect(crossings.length).toBeGreaterThanOrEqual(5);
		const twoPeriods = crossings[4] - crossings[0];
		const expected = 2 * ((2 * Math.PI) / omegaN);
		expect(Math.abs(twoPeriods - expected)).toBeLessThan(expected * 0.02);
	});

	it('never settles (no damping) and stays finite', () => {
		const segments = computeStepResponseMetrics(toSamples(trace));
		expect(segments[0].settleTimeSec).toBeNull();
		expectAllFinite(trace);
	});
});

describe('simulateClosedLoop — lab-mode scenario (default game PID)', () => {
	const trace = simulateClosedLoop({
		controller: gamePid(createActuatorModel('lab')),
		actuatorMode: 'lab',
		stepTime: 1.0 - DT / 2,
		initialSetpoint: 5,
		finalSetpoint: 6,
		durationSec: 12,
		dt: DT
	});
	const segments = computeStepResponseMetrics(toSamples(trace));

	it('shows textbook overshoot in the range the linear analysis predicts', () => {
		// Dominant closed-loop pair of the default gains: ζ ≈ 0.33 → ≈ 32%
		// linear overshoot; drag and the derivative filter shave a few points.
		expect(segments.length).toBe(1);
		expect(segments[0].overshootPercent).not.toBeNull();
		expect(segments[0].overshootPercent!).toBeGreaterThan(15);
		expect(segments[0].overshootPercent!).toBeLessThan(45);
	});

	it('oscillates and settles within the hold window used by the game schedule', () => {
		expect(segments[0].oscillationCount).toBeGreaterThanOrEqual(1);
		expect(segments[0].settleTimeSec).not.toBeNull();
		expect(segments[0].settleTimeSec!).toBeLessThan(6);
	});

	it('produces no NaN/Infinity in state or control', () => {
		expectAllFinite(trace);
	});
});

describe('simulateClosedLoop — arcade gravity bias vs lab symmetry', () => {
	// The pedagogical difference between the actuators: in arcade mode the
	// controller itself must generate the hover force m·g, in lab mode the
	// feedforward carries it. The warm-up (the arcade loop's slowest pole has
	// a ~8 s time constant) removes start-up transients before measuring.

	function pdSteadyStateY(actuatorMode: 'arcade' | 'lab'): number {
		const actuator = createActuatorModel(actuatorMode);
		const trace = simulateClosedLoop({
			controller: new PIDController({
				kp: GAME_PID_GAINS.kp,
				ki: 0, // no integral action — the point of the experiment
				kd: GAME_PID_GAINS.kd,
				outputMin: actuator.outputMin,
				outputMax: actuator.outputMax
			}),
			actuatorMode,
			stepTime: 1,
			initialSetpoint: 5,
			finalSetpoint: 5,
			durationSec: 10,
			dt: DT,
			warmupSec: 30
		});
		expectAllFinite(trace);
		return trace[trace.length - 1].y;
	}

	it('PD control (no integral) droops by exactly m·g/Kp in arcade mode', () => {
		// Steady state: Kp·e = m·g → e = 9.81/8 ≈ 1.226 m below the setpoint
		const expectedDroop = 9.81 / GAME_PID_GAINS.kp;
		expect(Math.abs(5 - pdSteadyStateY('arcade') - expectedDroop)).toBeLessThan(0.02);
	});

	it('PD control has zero steady-state error in lab mode', () => {
		expect(Math.abs(pdSteadyStateY('lab') - 5)).toBeLessThan(0.01);
	});

	it('with the full PID, a 1 m lab step overshoots symmetrically up and down', () => {
		const overshootFor = (finalSetpoint: number): number | null => {
			const trace = simulateClosedLoop({
				controller: gamePid(createActuatorModel('lab')),
				actuatorMode: 'lab',
				stepTime: 1 - DT / 2,
				initialSetpoint: 5,
				finalSetpoint,
				durationSec: 13,
				dt: DT,
				warmupSec: 30
			});
			const segments = computeStepResponseMetrics(toSamples(trace));
			expect(segments.length).toBe(1);
			return segments[0].overshootPercent;
		};
		const up = overshootFor(6);
		const down = overshootFor(4);
		expect(up).not.toBeNull();
		expect(down).not.toBeNull();
		expect(Math.abs(up! - down!)).toBeLessThan(1);
	});

	it('the on-off limit cycle is gravity-biased in arcade mode and centred in lab mode', () => {
		const meanOffset = (actuatorMode: 'arcade' | 'lab'): number => {
			const levels =
				actuatorMode === 'lab'
					? { highOutput: 6, lowOutput: -6 }
					: { highOutput: 30, lowOutput: 0 };
			const trace = simulateClosedLoop({
				controller: new OnOffController({ ...levels, threshold: 0, hysteresis: 0.3 }),
				actuatorMode,
				stepTime: 1,
				initialSetpoint: 5,
				finalSetpoint: 5,
				durationSec: 20,
				dt: DT,
				warmupSec: 30
			});
			expectAllFinite(trace);
			const tail = trace.filter((p) => p.t > 5);
			return tail.reduce((sum, p) => sum + p.y, 0) / tail.length - 5;
		};
		// Arcade: rise at +20 m/s², fall at −9.81 m/s² → cycle rides high
		expect(Math.abs(meanOffset('arcade'))).toBeGreaterThan(0.2);
		// Lab: symmetric ±6 N relay → cycle centred on the setpoint
		expect(Math.abs(meanOffset('lab'))).toBeLessThan(0.05);
	});
});
