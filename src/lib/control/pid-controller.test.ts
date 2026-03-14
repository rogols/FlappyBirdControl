/**
 * Unit tests for PIDController
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PIDController } from './pid-controller.ts';

const DT = 0.1;

describe('PIDController — P-only', () => {
	it('P-only output equals kp * error', () => {
		const controller = new PIDController({
			kp: 3,
			ki: 0,
			kd: 0,
			outputMin: -1000,
			outputMax: 1000
		});
		controller.reset();
		const { control } = controller.update({ t: 0, dt: DT, setpoint: 10, measurement: 7 });
		// error = 3, P-only output = 3 * 3 = 9
		expect(control).toBeCloseTo(9, 10);
	});

	it('negative error produces negative output with P-only', () => {
		const controller = new PIDController({
			kp: 2,
			ki: 0,
			kd: 0,
			outputMin: -1000,
			outputMax: 1000
		});
		controller.reset();
		const { control } = controller.update({ t: 0, dt: DT, setpoint: 5, measurement: 8 });
		// error = -3, P-only output = 2 * (-3) = -6
		expect(control).toBeCloseTo(-6, 10);
	});
});

describe('PIDController — I term accumulation', () => {
	it('integral accumulates over successive steps', () => {
		const controller = new PIDController({
			kp: 0,
			ki: 1,
			kd: 0,
			outputMin: -1000,
			outputMax: 1000
		});
		controller.reset();

		// Constant error of 2 for 5 steps
		let lastControl = 0;
		for (let i = 0; i < 5; i++) {
			const { control } = controller.update({ t: i * DT, dt: DT, setpoint: 7, measurement: 5 });
			// Control should grow each step
			if (i > 0) {
				expect(control).toBeGreaterThan(lastControl);
			}
			lastControl = control;
		}
	});

	it('I-only: output after N steps ≈ ki * error * (N-1) * dt', () => {
		// The PID implementation uses the integral from the *previous* step to compute output,
		// then accumulates the current error. So on step k, the output reflects integral accumulated
		// over steps 1..k-1. After N steps the last output uses integral from N-1 steps.
		const ki = 2.0;
		const controller = new PIDController({ kp: 0, ki, kd: 0, outputMin: -1000, outputMax: 1000 });
		controller.reset();

		const error = 3.0;
		const steps = 10;
		let control = 0;
		for (let i = 0; i < steps; i++) {
			({ control } = controller.update({
				t: i * DT,
				dt: DT,
				setpoint: error,
				measurement: 0
			}));
		}
		// Integral at the time of the last output = error * (steps - 1) * dt
		const expectedIntegral = error * (steps - 1) * DT;
		const expectedOutput = ki * expectedIntegral;
		expect(control).toBeCloseTo(expectedOutput, 5);
	});
});

describe('PIDController — D term', () => {
	it('D-only: first step has zero derivative (no derivative kick)', () => {
		const controller = new PIDController({
			kp: 0,
			ki: 0,
			kd: 5,
			filterCoeff: 0,
			outputMin: -1000,
			outputMax: 1000
		});
		controller.reset();
		const { control } = controller.update({ t: 0, dt: DT, setpoint: 5, measurement: 3 });
		// First step should have zero derivative (no previous error)
		expect(control).toBeCloseTo(0, 10);
	});

	it('D-only: second step reflects error change', () => {
		const kd = 5.0;
		const controller = new PIDController({
			kp: 0,
			ki: 0,
			kd,
			filterCoeff: 0,
			outputMin: -1000,
			outputMax: 1000
		});
		controller.reset();

		// First step: error = 2, derivative = 0 (no previous)
		controller.update({ t: 0, dt: DT, setpoint: 5, measurement: 3 });

		// Second step: error = 3 (measurement dropped), derivative = (3 - 2) / dt
		const { control } = controller.update({ t: DT, dt: DT, setpoint: 5, measurement: 2 });
		// raw derivative = (3 - 2) / 0.1 = 10, filtered with filterCoeff=0 → 10, output = kd * 10 = 50
		expect(control).toBeCloseTo(kd * (1 / DT), 5);
	});
});

describe('PIDController — anti-windup', () => {
	it('integral does not grow unboundedly when output is saturated', () => {
		const controller = new PIDController({
			kp: 0,
			ki: 10,
			kd: 0,
			outputMin: 0,
			outputMax: 5 // tight saturation
		});
		controller.reset();

		// Constant large error that would otherwise drive integral to infinity
		const steps = 100;
		let integral = 0;
		for (let i = 0; i < steps; i++) {
			const { internals } = controller.update({ t: i * DT, dt: DT, setpoint: 100, measurement: 0 });
			if (internals) integral = internals.rawIntegral;
		}

		// Without anti-windup, integral would be 100 * 100 * 0.1 = 1000
		// With anti-windup, it should be bounded
		expect(integral).toBeLessThan(100);
	});

	it('output respects outputMin bound', () => {
		const controller = new PIDController({ kp: 100, ki: 0, kd: 0, outputMin: -5, outputMax: 100 });
		controller.reset();
		const { control } = controller.update({ t: 0, dt: DT, setpoint: 0, measurement: 10 }); // large negative error * large kp
		expect(control).toBeGreaterThanOrEqual(-5);
	});

	it('output respects outputMax bound', () => {
		const controller = new PIDController({ kp: 100, ki: 0, kd: 0, outputMin: -100, outputMax: 5 });
		controller.reset();
		const { control } = controller.update({ t: 0, dt: DT, setpoint: 10, measurement: 0 }); // large positive error * large kp
		expect(control).toBeLessThanOrEqual(5);
	});
});

describe('PIDController — reset', () => {
	let controller: PIDController;

	beforeEach(() => {
		controller = new PIDController({ kp: 1, ki: 1, kd: 0, outputMin: -1000, outputMax: 1000 });
		controller.reset();
		// Accumulate some integral
		for (let i = 0; i < 10; i++) {
			controller.update({ t: i * DT, dt: DT, setpoint: 5, measurement: 0 });
		}
	});

	it('reset() clears integral accumulation', () => {
		controller.reset();
		// After reset, the integral state is zeroed. On the first update call, output = P term only
		// because the integral used for output is from the previous step (which is now 0).
		// P output = kp * error = 1 * 5 = 5.
		const { control } = controller.update({ t: 0, dt: DT, setpoint: 5, measurement: 0 });
		expect(control).toBeCloseTo(5, 5);
	});

	it('reset() with initialState restores integral', () => {
		controller.reset({ integral: 10, previousError: 0, filteredDerivative: 0, initialized: true });
		const { internals } = controller.update({ t: 0, dt: DT, setpoint: 5, measurement: 0 });
		// rawIntegral should start from 10 and grow by error * dt = 5 * 0.1
		expect(internals?.rawIntegral).toBeCloseTo(10 + 5 * DT, 5);
	});
});

describe('PIDController — derivative filter', () => {
	it('high filter coefficient smooths derivative', () => {
		// With filterCoeff close to 1, derivative changes slowly
		const filteredController = new PIDController({
			kp: 0,
			ki: 0,
			kd: 1,
			filterCoeff: 0.95,
			outputMin: -1000,
			outputMax: 1000
		});
		const rawController = new PIDController({
			kp: 0,
			ki: 0,
			kd: 1,
			filterCoeff: 0,
			outputMin: -1000,
			outputMax: 1000
		});

		filteredController.reset();
		rawController.reset();

		// Same first step (no derivative)
		filteredController.update({ t: 0, dt: DT, setpoint: 5, measurement: 0 });
		rawController.update({ t: 0, dt: DT, setpoint: 5, measurement: 0 });

		// Step change: measurement jumps significantly
		const filteredResult = filteredController.update({
			t: DT,
			dt: DT,
			setpoint: 5,
			measurement: 10
		});
		const rawResult = rawController.update({ t: DT, dt: DT, setpoint: 5, measurement: 10 });

		// Filtered derivative output should be smaller in magnitude than raw
		expect(Math.abs(filteredResult.control)).toBeLessThan(Math.abs(rawResult.control));
	});
});

describe('PIDController — no NaN', () => {
	it('never produces NaN or Infinity over 300 steps with default params', () => {
		const controller = new PIDController();
		controller.reset();
		for (let i = 0; i < 300; i++) {
			const measurement = 5 + Math.sin(i * 0.2) * 3;
			const { control, internals } = controller.update({
				t: i * DT,
				dt: DT,
				setpoint: 5,
				measurement
			});
			expect(isNaN(control)).toBe(false);
			expect(isFinite(control)).toBe(true);
			if (internals) {
				for (const value of Object.values(internals)) {
					expect(isNaN(value)).toBe(false);
				}
			}
		}
	});
});
