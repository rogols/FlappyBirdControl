/**
 * Unit tests for src/lib/game/actuator.ts
 *
 * Validates:
 * - Arcade model is bit-identical to the historical behaviour (no regression)
 * - Lab model derives symmetric clamps and consistent physics limits
 * - toPlantControl clamps then offsets; output always within plant limits
 * - Numeric robustness: no NaN/Infinity, invalid labLimit rejected
 */

import { describe, it, expect } from 'vitest';
import {
	createActuatorModel,
	defaultLabLimit,
	toPlantControl,
	controlEffortScale
} from './actuator';
import { DEFAULT_PHYSICS_PARAMS } from './physics';

describe('createActuatorModel — arcade', () => {
	it('matches the historical game constants exactly', () => {
		const model = createActuatorModel('arcade');
		expect(model.mode).toBe('arcade');
		expect(model.feedforward).toBe(0);
		expect(model.outputMin).toBe(0);
		expect(model.outputMax).toBe(40);
		expect(model.physicsParams).toEqual(DEFAULT_PHYSICS_PARAMS);
	});

	it('passes controller output through unchanged inside the limits', () => {
		const model = createActuatorModel('arcade');
		expect(toPlantControl(model, 25)).toBe(25);
		expect(toPlantControl(model, 0)).toBe(0);
	});

	it('clamps controller output to [0, 40]', () => {
		const model = createActuatorModel('arcade');
		expect(toPlantControl(model, -5)).toBe(0);
		expect(toPlantControl(model, 100)).toBe(40);
	});
});

describe('createActuatorModel — lab', () => {
	it('uses m·g as the default symmetric deviation limit', () => {
		expect(defaultLabLimit()).toBeCloseTo(9.81, 10);
		const model = createActuatorModel('lab');
		expect(model.feedforward).toBeCloseTo(9.81, 10);
		expect(model.outputMin).toBeCloseTo(-9.81, 10);
		expect(model.outputMax).toBeCloseTo(9.81, 10);
	});

	it('derives plant limits so total thrust stays realizable by the one-sided thruster', () => {
		const model = createActuatorModel('lab');
		expect(model.physicsParams.uMin).toBeCloseTo(0, 10);
		expect(model.physicsParams.uMax).toBeCloseTo(2 * 9.81, 10);
		expect(model.physicsParams.uMin).toBeGreaterThanOrEqual(DEFAULT_PHYSICS_PARAMS.uMin);
		expect(model.physicsParams.uMax).toBeLessThanOrEqual(DEFAULT_PHYSICS_PARAMS.uMax);
	});

	it('keeps controller clamp and plant saturation consistent for custom limits', () => {
		const model = createActuatorModel('lab', DEFAULT_PHYSICS_PARAMS, 5);
		expect(model.outputMin).toBeCloseTo(-5, 10);
		expect(model.outputMax).toBeCloseTo(5, 10);
		expect(model.physicsParams.uMin).toBeCloseTo(9.81 - 5, 10);
		expect(model.physicsParams.uMax).toBeCloseTo(9.81 + 5, 10);
	});

	it('narrows an oversized labLimit to what the base thruster can realize', () => {
		// labLimit larger than m·g: downward headroom is capped at uMin = 0
		const model = createActuatorModel('lab', DEFAULT_PHYSICS_PARAMS, 15);
		expect(model.physicsParams.uMin).toBe(DEFAULT_PHYSICS_PARAMS.uMin);
		expect(model.outputMin).toBeCloseTo(-9.81, 10);
		expect(model.outputMax).toBeCloseTo(15, 10);
	});

	it('adds the hover feedforward: zero controller output means hover thrust', () => {
		const model = createActuatorModel('lab');
		expect(toPlantControl(model, 0)).toBeCloseTo(9.81, 10);
	});

	it('clamps symmetric deviations before adding feedforward', () => {
		const model = createActuatorModel('lab');
		expect(toPlantControl(model, -100)).toBeCloseTo(0, 10);
		expect(toPlantControl(model, 100)).toBeCloseTo(2 * 9.81, 10);
		expect(toPlantControl(model, 4)).toBeCloseTo(9.81 + 4, 10);
		expect(toPlantControl(model, -4)).toBeCloseTo(9.81 - 4, 10);
	});

	it('rejects non-positive or non-finite labLimit', () => {
		expect(() => createActuatorModel('lab', DEFAULT_PHYSICS_PARAMS, 0)).toThrow();
		expect(() => createActuatorModel('lab', DEFAULT_PHYSICS_PARAMS, -1)).toThrow();
		expect(() => createActuatorModel('lab', DEFAULT_PHYSICS_PARAMS, NaN)).toThrow();
		expect(() => createActuatorModel('lab', DEFAULT_PHYSICS_PARAMS, Infinity)).toThrow();
	});
});

describe('toPlantControl — plant-limit invariant', () => {
	it('output always lies within [uMin, uMax] for any controller output', () => {
		const inputs = [-1e9, -40, -9.81, -1, 0, 1, 9.81, 40, 1e9];
		for (const mode of ['arcade', 'lab'] as const) {
			const model = createActuatorModel(mode);
			for (const u of inputs) {
				const plantU = toPlantControl(model, u);
				expect(plantU).toBeGreaterThanOrEqual(model.physicsParams.uMin);
				expect(plantU).toBeLessThanOrEqual(model.physicsParams.uMax);
				expect(Number.isFinite(plantU)).toBe(true);
			}
		}
	});
});

describe('controlEffortScale', () => {
	it('equals uMax in arcade mode (historical /40 normalisation)', () => {
		expect(controlEffortScale(createActuatorModel('arcade'))).toBe(40);
	});

	it('equals the deviation limit in lab mode', () => {
		expect(controlEffortScale(createActuatorModel('lab'))).toBeCloseTo(9.81, 10);
	});
});
