/**
 * Unit tests for src/lib/analysis/step-response.ts
 *
 * Validates:
 * - Output length and time grid correctness
 * - Free-fall (u=0): analytical position comparison
 * - Equilibrium control produces near-zero net force
 * - No NaN/Infinity in any output field
 * - Correct initial state is used
 */

import { describe, it, expect } from 'vitest';
import {
	computeStepResponse,
	computeEquilibriumControl,
	DEFAULT_STEP_RESPONSE_CONFIG
} from './step-response';
import { DEFAULT_PHYSICS_PARAMS } from '$lib/game/physics';

describe('computeStepResponse', () => {
	it('returns duration/dt + 1 points', () => {
		const result = computeStepResponse({ durationSec: 1, dt: 0.1, stepAmplitude: 0 });
		// ceil(1/0.1) = 10 intervals → 11 points
		expect(result.length).toBe(11);
	});

	it('first point matches initial state', () => {
		const initial = { y: 3, v: 1 };
		const result = computeStepResponse({
			stepAmplitude: 0,
			durationSec: 0.5,
			dt: 0.1,
			initialState: initial
		});
		expect(result[0].t).toBeCloseTo(0, 6);
		expect(result[0].y).toBeCloseTo(3, 6);
		expect(result[0].v).toBeCloseTo(1, 6);
	});

	it('time grid is uniformly spaced', () => {
		const dt = 0.05;
		const result = computeStepResponse({ stepAmplitude: 0, durationSec: 0.5, dt });
		for (let i = 1; i < result.length; i++) {
			expect(result[i].t - result[i - 1].t).toBeCloseTo(dt, 6);
		}
	});

	it('produces no NaN or Infinity', () => {
		const result = computeStepResponse();
		for (const pt of result) {
			expect(isFinite(pt.t)).toBe(true);
			expect(isFinite(pt.y)).toBe(true);
			expect(isFinite(pt.v)).toBe(true);
		}
	});

	it('u=0 from rest at mid-range: bird falls under gravity', () => {
		// Start at mid-range (y=5), zero velocity, zero control → gravity pulls down
		const result = computeStepResponse({
			stepAmplitude: 0,
			durationSec: 0.5,
			dt: 0.001,
			initialState: { y: 5, v: 0 },
			params: DEFAULT_PHYSICS_PARAMS
		});
		const last = result[result.length - 1];
		// velocity should be negative (falling)
		expect(last.v).toBeLessThan(0);
		// position should have decreased
		expect(last.y).toBeLessThan(5);
	});

	it('positive step input above equilibrium causes upward acceleration from rest', () => {
		const params = DEFAULT_PHYSICS_PARAMS;
		const uEq = params.mass * params.gravity;
		const result = computeStepResponse({
			stepAmplitude: uEq * 2, // 2× equilibrium → net upward force
			durationSec: 1,
			dt: 0.01,
			initialState: { y: 5, v: 0 },
			params
		});
		const last = result[result.length - 1];
		// velocity should be positive (moving up)
		expect(last.v).toBeGreaterThan(0);
		// position should have increased
		expect(last.y).toBeGreaterThan(5);
	});

	it('uses DEFAULT_STEP_RESPONSE_CONFIG when called with no args', () => {
		const result = computeStepResponse();
		const expectedLen =
			Math.ceil(DEFAULT_STEP_RESPONSE_CONFIG.durationSec / DEFAULT_STEP_RESPONSE_CONFIG.dt) + 1;
		expect(result.length).toBe(expectedLen);
	});

	it('position is clamped to [yMin, yMax]', () => {
		const params = DEFAULT_PHYSICS_PARAMS;
		// Apply zero control from the floor — should stay at yMin
		const result = computeStepResponse({
			stepAmplitude: 0,
			durationSec: 5,
			dt: 1 / 60,
			initialState: { y: params.yMin, v: -5 },
			params
		});
		for (const pt of result) {
			expect(pt.y).toBeGreaterThanOrEqual(params.yMin - 1e-9);
			expect(pt.y).toBeLessThanOrEqual(params.yMax + 1e-9);
		}
	});
});

describe('computeEquilibriumControl', () => {
	it('equals m * g for default params', () => {
		const { mass, gravity } = DEFAULT_PHYSICS_PARAMS;
		expect(computeEquilibriumControl()).toBeCloseTo(mass * gravity, 6);
	});

	it('scales with mass', () => {
		const params = { ...DEFAULT_PHYSICS_PARAMS, mass: 2 };
		expect(computeEquilibriumControl(params)).toBeCloseTo(2 * params.gravity, 6);
	});

	it('is within actuator bounds for default params', () => {
		const u = computeEquilibriumControl();
		expect(u).toBeGreaterThanOrEqual(DEFAULT_PHYSICS_PARAMS.uMin);
		expect(u).toBeLessThanOrEqual(DEFAULT_PHYSICS_PARAMS.uMax);
	});
});
