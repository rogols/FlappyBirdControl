/**
 * Unit tests for src/lib/ui/controller-defaults.ts
 *
 * Validates:
 * - Manual mode yields no controller
 * - PID output limits follow the actuator model
 * - On-Off levels are one-sided in arcade and symmetric in lab mode
 * - An analysis-applied TFController is reused when its limits match and
 *   rebuilt with the same C(s) when they do not
 */

import { describe, it, expect } from 'vitest';
import { createControllerForMode, GAME_ONOFF_LEVELS } from './controller-defaults';
import { createActuatorModel } from '$lib/game/actuator';
import { OnOffController } from '$lib/control/onoff-controller';
import { PIDController } from '$lib/control/pid-controller';
import { TFController } from '$lib/control/tf-controller';

const arcade = createActuatorModel('arcade');
const lab = createActuatorModel('lab');

describe('createControllerForMode — manual', () => {
	it('returns null', () => {
		expect(createControllerForMode('manual', arcade)).toBeNull();
		expect(createControllerForMode('manual', lab)).toBeNull();
	});
});

describe('createControllerForMode — PID', () => {
	it('clamps to [0, 40] in arcade mode', () => {
		const pid = createControllerForMode('auto-pid', arcade);
		expect(pid).toBeInstanceOf(PIDController);
		// Force a huge negative error: output must clamp at the arcade floor 0
		const low = pid!.update({ t: 0, dt: 1 / 60, setpoint: 0, measurement: 100 });
		expect(low.control).toBe(0);
	});

	it('clamps symmetrically in lab mode', () => {
		const pid = createControllerForMode('auto-pid', lab);
		const low = pid!.update({ t: 0, dt: 1 / 60, setpoint: 0, measurement: 100 });
		expect(low.control).toBeCloseTo(lab.outputMin, 10);
		pid!.reset();
		const high = pid!.update({ t: 0, dt: 1 / 60, setpoint: 100, measurement: 0 });
		expect(high.control).toBeCloseTo(lab.outputMax, 10);
	});
});

describe('createControllerForMode — On-Off', () => {
	it('uses one-sided levels in arcade mode', () => {
		const onoff = createControllerForMode('auto-onoff', arcade) as OnOffController;
		expect(onoff).toBeInstanceOf(OnOffController);
		const high = onoff.update({ t: 0, dt: 1 / 60, setpoint: 10, measurement: 0 });
		expect(high.control).toBe(GAME_ONOFF_LEVELS.arcade.highOutput);
		const low = onoff.update({ t: 0, dt: 1 / 60, setpoint: 0, measurement: 10 });
		expect(low.control).toBe(GAME_ONOFF_LEVELS.arcade.lowOutput);
	});

	it('uses symmetric ± levels in lab mode', () => {
		const onoff = createControllerForMode('auto-onoff', lab) as OnOffController;
		const high = onoff.update({ t: 0, dt: 1 / 60, setpoint: 10, measurement: 0 });
		expect(high.control).toBe(GAME_ONOFF_LEVELS.lab.highOutput);
		const low = onoff.update({ t: 0, dt: 1 / 60, setpoint: 0, measurement: 10 });
		expect(low.control).toBe(GAME_ONOFF_LEVELS.lab.lowOutput);
		expect(GAME_ONOFF_LEVELS.lab.lowOutput).toBe(-GAME_ONOFF_LEVELS.lab.highOutput);
	});
});

describe('createControllerForMode — Transfer Function', () => {
	it('reuses an existing TFController whose limits match the actuator', () => {
		const existing = new TFController({
			numerator: [2, 8],
			denominator: [0.05, 1],
			dt: 1 / 60,
			outputMin: arcade.outputMin,
			outputMax: arcade.outputMax
		});
		const result = createControllerForMode('auto-tf', arcade, existing);
		expect(result).toBe(existing);
	});

	it('rebuilds with the same C(s) but new limits when the actuator changes', () => {
		const existing = new TFController({
			numerator: [3, 12],
			denominator: [0.1, 1],
			dt: 1 / 60,
			outputMin: arcade.outputMin,
			outputMax: arcade.outputMax
		});
		const rebuilt = createControllerForMode('auto-tf', lab, existing) as TFController;
		expect(rebuilt).not.toBe(existing);
		expect(rebuilt.getParams().numerator).toEqual([3, 12]);
		expect(rebuilt.getParams().denominator).toEqual([0.1, 1]);
		expect(rebuilt.getParams().outputMin).toBeCloseTo(lab.outputMin, 10);
		expect(rebuilt.getParams().outputMax).toBeCloseTo(lab.outputMax, 10);
		// Same discretized coefficients — the controller dynamics are unchanged
		expect(rebuilt.getDiscreteCoeffs()).toEqual(existing.getDiscreteCoeffs());
	});

	it('creates the default C(s) with actuator limits when nothing exists', () => {
		const tf = createControllerForMode('auto-tf', lab) as TFController;
		expect(tf).toBeInstanceOf(TFController);
		expect(tf.getParams().outputMin).toBeCloseTo(lab.outputMin, 10);
		expect(tf.getParams().outputMax).toBeCloseTo(lab.outputMax, 10);
		expect(tf.isReady()).toBe(true);
	});
});
