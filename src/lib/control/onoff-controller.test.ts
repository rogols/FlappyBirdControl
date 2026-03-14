/**
 * Unit tests for OnOffController
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnOffController } from './onoff-controller.ts';

describe('OnOffController — basic switching', () => {
	it('outputs highOutput when error is above threshold', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0,
			highOutput: 10,
			lowOutput: 0
		});
		controller.reset();
		const result = controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 }); // error = 2 > 0
		expect(result.control).toBe(10);
	});

	it('outputs lowOutput when error is below threshold', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0,
			highOutput: 10,
			lowOutput: 0
		});
		// First drive state to high
		controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 });
		// Then bring error below threshold
		const result = controller.update({ t: 0.1, dt: 0.1, setpoint: 5, measurement: 6 }); // error = -1 < 0
		expect(result.control).toBe(0);
	});

	it('starts in low state by default', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0,
			highOutput: 10,
			lowOutput: 2
		});
		controller.reset();
		// With error = 0 (at boundary with hysteresis = 0), initial state is low
		// error > threshold: 0 > 0 is false → stays low
		const result = controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 5 });
		expect(result.control).toBe(2);
	});
});

describe('OnOffController — hysteresis', () => {
	let controller: OnOffController;

	beforeEach(() => {
		controller = new OnOffController({
			threshold: 0,
			hysteresis: 1.0,
			highOutput: 10,
			lowOutput: 0
		});
		controller.reset();
	});

	it('does not switch to high when error is within hysteresis band from low state', () => {
		// In low state, error must exceed threshold + hysteresis = 0 + 1 = 1 to switch to high
		const result = controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 4.5 }); // error = 0.5, not > 1
		expect(result.control).toBe(0);
	});

	it('switches to high when error exceeds threshold + hysteresis', () => {
		const result = controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 }); // error = 2 > 1
		expect(result.control).toBe(10);
	});

	it('holds high state when error falls into hysteresis band', () => {
		// Switch to high first
		controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 }); // error = 2 → high

		// Error now in band: threshold - hysteresis = -1 < error = 0.5 < threshold + hysteresis = 1
		const result = controller.update({ t: 0.1, dt: 0.1, setpoint: 5, measurement: 4.5 }); // error = 0.5
		expect(result.control).toBe(10); // Should hold high
	});

	it('switches to low when error falls below threshold - hysteresis', () => {
		// Switch to high first
		controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 }); // error = 2 → high

		// Now bring error below threshold - hysteresis = -1
		const result = controller.update({ t: 0.1, dt: 0.1, setpoint: 5, measurement: 7 }); // error = -2 < -1
		expect(result.control).toBe(0);
	});

	it('does not switch to low when error is within hysteresis band from high state', () => {
		// Switch to high
		controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 }); // error = 2 → high

		// Error in band
		const result = controller.update({ t: 0.1, dt: 0.1, setpoint: 5, measurement: 5.5 }); // error = -0.5, within [-1, 1]
		expect(result.control).toBe(10); // Still high
	});
});

describe('OnOffController — reset', () => {
	it('reset() clears state to low', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0,
			highOutput: 10,
			lowOutput: 5
		});
		// Drive to high
		controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 3 });
		// Reset
		controller.reset();
		// Error is below threshold — should be low
		const result = controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 6 }); // error = -1
		expect(result.control).toBe(5);
	});

	it('reset() with initialState sets isHigh=true correctly', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0.5,
			highOutput: 10,
			lowOutput: 0
		});
		controller.reset({ isHigh: true });
		// Error is in band (0.3, within [-0.5, 0.5]) — should hold high because state was seeded as high
		const result = controller.update({ t: 0, dt: 0.1, setpoint: 5, measurement: 4.7 }); // error = 0.3
		expect(result.control).toBe(10);
	});
});

describe('OnOffController — internals', () => {
	it('returns error in internals', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0,
			highOutput: 10,
			lowOutput: 0
		});
		controller.reset();
		const { internals } = controller.update({ t: 0, dt: 0.1, setpoint: 7, measurement: 4 });
		expect(internals?.error).toBeCloseTo(3);
	});

	it('returns isHigh=1 when in high state', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0,
			highOutput: 10,
			lowOutput: 0
		});
		controller.reset();
		const { internals } = controller.update({ t: 0, dt: 0.1, setpoint: 7, measurement: 4 });
		expect(internals?.isHigh).toBe(1);
	});
});

describe('OnOffController — no NaN', () => {
	it('never produces NaN over many updates', () => {
		const controller = new OnOffController({
			threshold: 0,
			hysteresis: 0.2,
			highOutput: 10,
			lowOutput: 0
		});
		controller.reset();
		for (let i = 0; i < 200; i++) {
			const measurement = 5 + Math.sin(i * 0.3) * 3; // deterministic oscillation
			const { control } = controller.update({ t: i * 0.1, dt: 0.1, setpoint: 5, measurement });
			expect(isNaN(control)).toBe(false);
		}
	});
});
