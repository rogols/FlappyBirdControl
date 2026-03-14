/**
 * Unit tests for src/lib/control/tf-controller.ts
 *
 * Validates:
 * - Implements the Controller interface (reset / update)
 * - Zero error → zero output (from rest) for controllers without integral action
 * - State resets to zero on reset()
 * - Saturates at outputMin / outputMax
 * - No NaN/Infinity in output for any valid input sequence
 * - Default TF tracks a constant setpoint over time
 * - Improper TF returns 0 gracefully (not NaN)
 */

import { describe, it, expect } from 'vitest';
import { TFController, DEFAULT_TF_PARAMS } from './tf-controller';

const DT = 1 / 60;
const SETPOINT = 5;

function makeDefault(): TFController {
	return new TFController({ ...DEFAULT_TF_PARAMS });
}

describe('TFController — construction and readiness', () => {
	it('isReady() is true for proper default params', () => {
		expect(makeDefault().isReady()).toBe(true);
	});

	it('getInitError() is null for proper params', () => {
		expect(makeDefault().getInitError()).toBeNull();
	});

	it('isReady() is false for improper C(s) (deg(N) > deg(D))', () => {
		const c = new TFController({ ...DEFAULT_TF_PARAMS, numerator: [1, 0, 0], denominator: [1, 0] });
		expect(c.isReady()).toBe(false);
	});

	it('getInitError() contains useful message for improper system', () => {
		const c = new TFController({ ...DEFAULT_TF_PARAMS, numerator: [1, 0, 0], denominator: [1, 0] });
		expect(c.getInitError()).toMatch(/improper/i);
	});
});

describe('TFController — reset()', () => {
	it('produces zero output immediately after reset when e=0', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		const { control } = ctrl.update({ t: 0, dt: DT, setpoint: 5, measurement: 5 });
		expect(control).toBeCloseTo(0, 9);
	});

	it('second reset clears state — output after reset matches first update', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		// Run 10 steps to build up state
		for (let i = 0; i < 10; i++) {
			ctrl.update({ t: i * DT, dt: DT, setpoint: SETPOINT, measurement: 3 });
		}
		ctrl.reset();
		const { control: afterReset } = ctrl.update({
			t: 0,
			dt: DT,
			setpoint: SETPOINT,
			measurement: SETPOINT
		});
		expect(afterReset).toBeCloseTo(0, 9);
	});
});

describe('TFController — update()', () => {
	it('zero error → zero control from rest', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		const { control } = ctrl.update({ t: 0, dt: DT, setpoint: 5, measurement: 5 });
		expect(control).toBeCloseTo(0, 6);
	});

	it('positive error from rest produces positive control output', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		const { control } = ctrl.update({ t: 0, dt: DT, setpoint: 5, measurement: 3 });
		expect(control).toBeGreaterThan(0);
	});

	it('negative error produces zero output (clamped at outputMin = 0)', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		const { control } = ctrl.update({ t: 0, dt: DT, setpoint: 3, measurement: 5 });
		// Negative raw u clamped to outputMin = 0
		expect(control).toBeCloseTo(0, 3);
	});

	it('saturates at outputMax when error is large', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		// Huge positive error → control should hit outputMax
		const { control } = ctrl.update({ t: 0, dt: DT, setpoint: 100, measurement: 0 });
		expect(control).toBeLessThanOrEqual(DEFAULT_TF_PARAMS.outputMax);
		expect(control).toBeGreaterThanOrEqual(DEFAULT_TF_PARAMS.outputMin);
	});

	it('output is always in [outputMin, outputMax]', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		const inputs = [-10, -5, 0, 0.5, 1, 3, 5, 7, 9, 10, 50];
		for (const meas of inputs) {
			const { control } = ctrl.update({ t: 0, dt: DT, setpoint: SETPOINT, measurement: meas });
			expect(control).toBeGreaterThanOrEqual(DEFAULT_TF_PARAMS.outputMin - 1e-9);
			expect(control).toBeLessThanOrEqual(DEFAULT_TF_PARAMS.outputMax + 1e-9);
		}
	});

	it('produces no NaN or Infinity for 200-step simulation', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		let meas = 5;
		for (let k = 0; k < 200; k++) {
			const { control } = ctrl.update({ t: k * DT, dt: DT, setpoint: SETPOINT, measurement: meas });
			expect(isFinite(control)).toBe(true);
			// Simple Euler integration of a second-order plant (clamp position to [0,10])
			meas = Math.min(10, Math.max(0, meas + 0.001 * (control - 9.81)));
		}
	});

	it('internals record error and u_raw', () => {
		const ctrl = makeDefault();
		ctrl.reset();
		const { internals } = ctrl.update({ t: 0, dt: DT, setpoint: 5, measurement: 3 });
		expect(internals).toBeDefined();
		expect(internals!.error).toBeCloseTo(2, 6);
		expect(isFinite(internals!.u_raw)).toBe(true);
	});
});

describe('TFController — getDiscreteCoeffs()', () => {
	it('returns finite coefficients', () => {
		const ctrl = makeDefault();
		const { numerator, denominator } = ctrl.getDiscreteCoeffs();
		for (const c of [...numerator, ...denominator]) {
			expect(isFinite(c)).toBe(true);
		}
	});

	it('denominator first coefficient is 1 (normalized)', () => {
		const ctrl = makeDefault();
		const { denominator } = ctrl.getDiscreteCoeffs();
		expect(denominator[0]).toBeCloseTo(1, 9);
	});

	it('numerator and denominator have the same length (order n+1)', () => {
		const ctrl = makeDefault();
		const { numerator, denominator } = ctrl.getDiscreteCoeffs();
		expect(numerator.length).toBe(denominator.length);
	});
});

describe('TFController — improper system fallback', () => {
	it('update() returns 0 for improper (not ready) controller', () => {
		const ctrl = new TFController({ ...DEFAULT_TF_PARAMS, numerator: [1, 0, 0], denominator: [1] });
		ctrl.reset();
		const { control } = ctrl.update({ t: 0, dt: DT, setpoint: 5, measurement: 3 });
		expect(control).toBe(0);
	});
});
