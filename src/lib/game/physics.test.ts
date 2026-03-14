/**
 * Unit tests for physics.ts
 *
 * Tests the discrete 2nd-order ODE plant model.
 * All tests use known analytical results or monotonicity properties.
 */

import { describe, it, expect } from 'vitest';
import { stepPhysics, saturateControl, DEFAULT_PHYSICS_PARAMS } from './physics.ts';
import type { PhysicsParams, PhysicsState } from './physics.ts';

// A minimal params set for isolated testing
const TEST_PARAMS: PhysicsParams = {
	mass: 1.0,
	gravity: 10.0, // round number for easier manual verification
	dragCoeff: 0.5,
	uMin: 0.0,
	uMax: 40.0,
	yMin: 0.0,
	yMax: 100.0, // large enough not to trigger bounds
	vMax: 200.0 // large enough not to trigger bounds
};

const INITIAL_STATE: PhysicsState = { y: 50.0, v: 0.0 };
const DT = 1 / 60; // standard simulation step

describe('saturateControl', () => {
	it('passes through a value within bounds', () => {
		expect(saturateControl(10, TEST_PARAMS)).toBe(10);
	});

	it('clamps values above uMax to uMax', () => {
		expect(saturateControl(100, TEST_PARAMS)).toBe(TEST_PARAMS.uMax);
	});

	it('clamps values below uMin to uMin', () => {
		expect(saturateControl(-5, TEST_PARAMS)).toBe(TEST_PARAMS.uMin);
	});
});

describe('stepPhysics — free fall (u=0, d=0)', () => {
	it('velocity becomes more negative under gravity', () => {
		const nextState = stepPhysics(INITIAL_STATE, 0, 0, TEST_PARAMS, DT);
		// With gravity pulling down, velocity should decrease (become negative)
		expect(nextState.v).toBeLessThan(INITIAL_STATE.v);
	});

	it('position decreases when falling', () => {
		// Simulate several steps to accumulate downward motion
		let state = INITIAL_STATE;
		for (let i = 0; i < 30; i++) {
			state = stepPhysics(state, 0, 0, TEST_PARAMS, DT);
		}
		expect(state.y).toBeLessThan(INITIAL_STATE.y);
	});

	it('velocity after one step matches analytical value (no drag at v=0)', () => {
		// At v=0, drag = 0, so a = (0 - m*g - 0 + 0) / m = -g
		// Semi-implicit Euler: v1 = v0 + a*dt = 0 + (-10) * (1/60)
		const expectedVelocity = -10 * DT;
		const nextState = stepPhysics(INITIAL_STATE, 0, 0, TEST_PARAMS, DT);
		expect(nextState.v).toBeCloseTo(expectedVelocity, 10);
	});

	it('produces no NaN or Infinity values', () => {
		let state = INITIAL_STATE;
		for (let i = 0; i < 200; i++) {
			state = stepPhysics(state, 0, 0, TEST_PARAMS, DT);
		}
		expect(isNaN(state.y)).toBe(false);
		expect(isNaN(state.v)).toBe(false);
		expect(isFinite(state.y)).toBe(true);
		expect(isFinite(state.v)).toBe(true);
	});
});

describe('stepPhysics — drag behaviour', () => {
	it('drag reduces terminal speed compared to no-drag case', () => {
		// With drag, the bird accelerates less at high speed than without
		const noDragParams: PhysicsParams = { ...TEST_PARAMS, dragCoeff: 0 };
		const highDragParams: PhysicsParams = { ...TEST_PARAMS, dragCoeff: 2.0 };

		let noDragState: PhysicsState = { y: 50, v: 0 };
		let highDragState: PhysicsState = { y: 50, v: 0 };

		// Run for many steps to build up speed
		for (let i = 0; i < 120; i++) {
			noDragState = stepPhysics(noDragState, 0, 0, noDragParams, DT);
			highDragState = stepPhysics(highDragState, 0, 0, highDragParams, DT);
		}

		// High drag should result in slower (less negative) velocity
		expect(Math.abs(highDragState.v)).toBeLessThan(Math.abs(noDragState.v));
	});

	it('drag force is speed-dependent (faster = more drag)', () => {
		// A bird falling faster should experience greater deceleration from drag
		const slowState: PhysicsState = { y: 50, v: -5 };
		const fastState: PhysicsState = { y: 50, v: -10 };

		const slowNext = stepPhysics(slowState, 0, 0, TEST_PARAMS, DT);
		const fastNext = stepPhysics(fastState, 0, 0, TEST_PARAMS, DT);

		// The change in velocity should be smaller (less acceleration) for the faster bird
		// because drag opposes motion and grows with |v|
		const slowDeltaV = slowNext.v - slowState.v;
		const fastDeltaV = fastNext.v - fastState.v;

		// Both are negative (accelerating downward or decelerating upward depending on sign)
		// For downward motion (negative v), drag opposes (acts upward = positive)
		// So fast bird's acceleration is less negative than slow bird's
		expect(fastDeltaV).toBeGreaterThan(slowDeltaV);
	});
});

describe('stepPhysics — actuator saturation', () => {
	it('a control input above uMax is clamped to uMax', () => {
		// Apply a huge control input and compare to uMax
		const withHuge = stepPhysics(INITIAL_STATE, 9999, 0, TEST_PARAMS, DT);
		const withMax = stepPhysics(INITIAL_STATE, TEST_PARAMS.uMax, 0, TEST_PARAMS, DT);
		expect(withHuge.v).toBeCloseTo(withMax.v, 10);
		expect(withHuge.y).toBeCloseTo(withMax.y, 10);
	});

	it('a negative control input below uMin is clamped to uMin', () => {
		const withNegative = stepPhysics(INITIAL_STATE, -100, 0, TEST_PARAMS, DT);
		const withMin = stepPhysics(INITIAL_STATE, TEST_PARAMS.uMin, 0, TEST_PARAMS, DT);
		expect(withNegative.v).toBeCloseTo(withMin.v, 10);
		expect(withNegative.y).toBeCloseTo(withMin.y, 10);
	});
});

describe('stepPhysics — position and velocity bounds', () => {
	it('position does not go below yMin even after many free-fall steps', () => {
		const boundsParams: PhysicsParams = { ...TEST_PARAMS, yMin: 0, yMax: 100 };
		let state: PhysicsState = { y: 0.1, v: -50 }; // about to hit floor

		for (let i = 0; i < 60; i++) {
			state = stepPhysics(state, 0, 0, boundsParams, DT);
		}
		expect(state.y).toBeGreaterThanOrEqual(boundsParams.yMin);
	});

	it('position does not exceed yMax under full thrust for many steps', () => {
		const boundsParams: PhysicsParams = { ...TEST_PARAMS, yMin: 0, yMax: 10 };
		let state: PhysicsState = { y: 9.9, v: 50 }; // about to hit ceiling

		for (let i = 0; i < 60; i++) {
			state = stepPhysics(state, boundsParams.uMax, 0, boundsParams, DT);
		}
		expect(state.y).toBeLessThanOrEqual(boundsParams.yMax);
	});

	it('velocity is zeroed when position hits floor', () => {
		const boundsParams: PhysicsParams = { ...TEST_PARAMS, yMin: 0, yMax: 100, vMax: 200 };
		let state: PhysicsState = { y: 0.001, v: -100 };
		state = stepPhysics(state, 0, 0, boundsParams, DT);

		// After hitting floor, downward velocity should be zeroed
		expect(state.y).toBe(boundsParams.yMin);
		expect(state.v).toBe(0);
	});
});

describe('stepPhysics — DEFAULT_PHYSICS_PARAMS', () => {
	it('default params produce no NaN over 600 steps at rest', () => {
		let state: PhysicsState = { y: 5, v: 0 };
		for (let i = 0; i < 600; i++) {
			state = stepPhysics(state, 0, 0, DEFAULT_PHYSICS_PARAMS, 1 / 60);
			expect(isNaN(state.y)).toBe(false);
			expect(isNaN(state.v)).toBe(false);
		}
	});
});

describe('stepPhysics — disturbance', () => {
	it('positive disturbance causes more upward acceleration than zero disturbance', () => {
		const withDisturbance = stepPhysics(INITIAL_STATE, 0, 5, TEST_PARAMS, DT);
		const withoutDisturbance = stepPhysics(INITIAL_STATE, 0, 0, TEST_PARAMS, DT);
		expect(withDisturbance.v).toBeGreaterThan(withoutDisturbance.v);
	});
});
