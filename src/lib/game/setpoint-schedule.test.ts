/**
 * Unit tests for src/lib/game/setpoint-schedule.ts
 *
 * Validates:
 * - Constant schedule holds baseLevel forever
 * - Square schedule: start delay, hold boundaries, alternation
 * - Determinism (pure function of t)
 * - Default schedule levels stay within the world bounds
 */

import { describe, it, expect } from 'vitest';
import { setpointAt, DEFAULT_SETPOINT_SCHEDULE } from './setpoint-schedule';
import type { SetpointScheduleConfig } from './setpoint-schedule';
import { DEFAULT_PHYSICS_PARAMS } from './physics';

const square: SetpointScheduleConfig = {
	kind: 'square',
	baseLevel: 5.0,
	levels: [5.5, 4.5],
	holdSec: 6.0,
	startDelaySec: 3.0
};

describe('setpointAt — constant schedule', () => {
	it('returns baseLevel at all times', () => {
		const constant: SetpointScheduleConfig = { ...square, kind: 'constant' };
		for (const t of [0, 1, 3, 9, 100, 1e6]) {
			expect(setpointAt(constant, t)).toBe(5.0);
		}
	});
});

describe('setpointAt — square schedule', () => {
	it('holds baseLevel during the start delay', () => {
		expect(setpointAt(square, 0)).toBe(5.0);
		expect(setpointAt(square, 2.999)).toBe(5.0);
	});

	it('steps to the first level exactly at the start delay', () => {
		expect(setpointAt(square, 3.0)).toBe(5.5);
	});

	it('holds the first level until the first hold boundary', () => {
		expect(setpointAt(square, 8.999)).toBe(5.5);
	});

	it('alternates levels at each hold boundary', () => {
		expect(setpointAt(square, 9.0)).toBe(4.5); // 3 + 6
		expect(setpointAt(square, 14.999)).toBe(4.5);
		expect(setpointAt(square, 15.0)).toBe(5.5); // 3 + 12
		expect(setpointAt(square, 21.0)).toBe(4.5); // 3 + 18
	});

	it('is deterministic: same t always yields the same value', () => {
		for (const t of [0, 3, 7.25, 12.5, 60.01]) {
			expect(setpointAt(square, t)).toBe(setpointAt(square, t));
		}
	});
});

describe('DEFAULT_SETPOINT_SCHEDULE', () => {
	it('keeps every level within the world position bounds', () => {
		const { yMin, yMax } = DEFAULT_PHYSICS_PARAMS;
		const values = [
			DEFAULT_SETPOINT_SCHEDULE.baseLevel,
			DEFAULT_SETPOINT_SCHEDULE.levels[0],
			DEFAULT_SETPOINT_SCHEDULE.levels[1]
		];
		for (const v of values) {
			expect(v).toBeGreaterThan(yMin);
			expect(v).toBeLessThan(yMax);
		}
	});

	it('uses a square schedule with a positive hold and start delay', () => {
		expect(DEFAULT_SETPOINT_SCHEDULE.kind).toBe('square');
		expect(DEFAULT_SETPOINT_SCHEDULE.holdSec).toBeGreaterThan(0);
		expect(DEFAULT_SETPOINT_SCHEDULE.startDelaySec).toBeGreaterThan(0);
	});
});
