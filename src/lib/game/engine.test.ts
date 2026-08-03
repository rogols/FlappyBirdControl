/**
 * Unit tests for src/lib/game/engine.ts
 *
 * Validates:
 * - Obstacles spawn by default and are suppressed with spawnObstacles: false
 * - Runs are deterministic for a fixed seed
 * - Injected physics params (lab actuator limits) are respected by the plant
 */

import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { createActuatorModel, toPlantControl } from './actuator';

/** Advance the engine by n fixed steps of 1/60 s each. */
function tickSteps(engine: GameEngine, n: number, control: number): void {
	for (let k = 0; k < n; k++) {
		engine.setControl(control);
		engine.tick(1 / 60);
	}
}

describe('GameEngine — obstacle spawning', () => {
	it('spawns obstacles by default', () => {
		const engine = new GameEngine({ seed: 42 });
		engine.start();
		tickSteps(engine, 120, 9.81); // 2 s of hover
		expect(engine.getState().obstacles.length).toBeGreaterThan(0);
	});

	it('never spawns obstacles when spawnObstacles is false', () => {
		const engine = new GameEngine({ seed: 42, spawnObstacles: false });
		engine.start();
		tickSteps(engine, 600, 9.81); // 10 s of hover
		const state = engine.getState();
		expect(state.obstacles.length).toBe(0);
		expect(state.alive).toBe(true);
	});
});

describe('GameEngine — determinism', () => {
	it('produces identical trajectories for the same seed and inputs', () => {
		const run = (): number[] => {
			const engine = new GameEngine({ seed: 7, spawnObstacles: false });
			engine.start();
			const ys: number[] = [];
			for (let k = 0; k < 300; k++) {
				engine.setControl(k % 30 < 10 ? 15 : 5);
				engine.tick(1 / 60);
				ys.push(engine.getState().physics.y);
			}
			return ys;
		};
		expect(run()).toEqual(run());
	});
});

describe('GameEngine — injected physics params', () => {
	it('saturates thrust to the lab actuator limits', () => {
		const actuator = createActuatorModel('lab');
		const engine = new GameEngine({
			seed: 1,
			spawnObstacles: false,
			physicsParams: actuator.physicsParams
		});
		engine.start();
		// Command far above the lab plant limit (2·m·g ≈ 19.62 N): with the
		// arcade limit (40 N) the bird would accelerate upward much faster.
		tickSteps(engine, 60, toPlantControl(actuator, 1000));
		const labY = engine.getState().physics.y;

		const arcade = new GameEngine({ seed: 1, spawnObstacles: false });
		arcade.start();
		tickSteps(arcade, 60, 1000);
		const arcadeY = arcade.getState().physics.y;

		expect(labY).toBeLessThan(arcadeY);
		expect(Number.isFinite(labY)).toBe(true);
	});
});
