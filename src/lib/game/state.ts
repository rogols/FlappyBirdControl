/**
 * World state and seeded RNG for the Flappy Bird simulation.
 *
 * RNG: mulberry32 — a fast, high-quality 32-bit PRNG suitable for deterministic simulation.
 * Never use Math.random() in simulation code — always use the seeded RNG from WorldState.
 */

import type { PhysicsState } from './physics.ts';
import type { Obstacle } from './obstacles.ts';

/**
 * Create a mulberry32 seeded pseudo-random number generator.
 * Returns a function that produces floats in [0, 1) on each call.
 *
 * @param seed - 32-bit unsigned integer seed
 * @returns Stateful PRNG function — each call advances internal state and returns next value
 */
export function createRng(seed: number): () => number {
	let state = seed >>> 0; // Ensure unsigned 32-bit

	return function nextRandom(): number {
		// mulberry32 algorithm
		state = (state + 0x6d2b79f5) >>> 0;
		let z = state;
		z = Math.imul(z ^ (z >>> 15), z | 1);
		z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
		return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
	};
}

/**
 * Complete world state snapshot for the simulation.
 * This is everything needed to reproduce the game from a checkpoint.
 */
export interface WorldState {
	/** Current physics state (position and velocity of bird) */
	physics: PhysicsState;
	/** Active obstacles in the world */
	obstacles: Obstacle[];
	/** Number of obstacles successfully passed */
	score: number;
	/** Simulation time elapsed (seconds) */
	time: number;
	/** Whether the bird is still alive (no collision) */
	alive: boolean;
	/** Current RNG seed state — snapshot for deterministic replay */
	rngSeed: number;
}

/**
 * Create a fresh initial world state with the bird positioned at the center-height.
 *
 * @param seed - Seed for deterministic RNG initialisation
 * @returns Initial WorldState ready to step
 */
export function createInitialState(seed: number): WorldState {
	return {
		physics: {
			y: 5.0, // Start at mid-height of [0, 10] range
			v: 0.0
		},
		obstacles: [],
		score: 0,
		time: 0,
		alive: true,
		rngSeed: seed >>> 0
	};
}
