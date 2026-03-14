/**
 * Game engine — orchestrates physics, obstacles, collision detection, and the simulation clock.
 *
 * Design principles:
 * - Deterministic: seeded RNG, fixed-dt sub-stepping.
 * - Controller-agnostic: accepts a control value u each tick via setControl().
 * - Pure simulation: no rendering, no I/O. The renderer reads state via getState().
 */

import { stepPhysics, DEFAULT_PHYSICS_PARAMS } from './physics.ts';
import type { PhysicsParams } from './physics.ts';
import {
	createInitialState,
	createRng
} from './state.ts';
import type { WorldState } from './state.ts';
import {
	spawnObstacle,
	updateObstacles,
	markPassedObstacles,
	DEFAULT_OBSTACLE_CONFIG
} from './obstacles.ts';
import type { ObstacleConfig } from './obstacles.ts';
import { checkCollision } from './collision.ts';
import type { WorldBounds } from './collision.ts';

export interface GameConfig {
	/** Seed for deterministic RNG */
	seed: number;
	/** Fixed simulation time step (seconds). Default: 1/60 */
	fixedDt: number;
	/** Physics parameters */
	physicsParams: PhysicsParams;
	/** Obstacle generation configuration */
	obstacleConfig: ObstacleConfig;
	/** Bird collision radius (world units) */
	birdRadius: number;
	/** Half-width of obstacle pipes (world units) */
	obstacleHalfWidth: number;
	/** Horizontal distance between obstacle spawns (world units) */
	obstacleSpacing: number;
	/** Horizontal scroll speed (world units per second) */
	scrollSpeed: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
	seed: 42,
	fixedDt: 1 / 60,
	physicsParams: DEFAULT_PHYSICS_PARAMS,
	obstacleConfig: DEFAULT_OBSTACLE_CONFIG,
	birdRadius: 0.3,
	obstacleHalfWidth: 0.5,
	obstacleSpacing: 6.0,
	scrollSpeed: 3.0
};

const WORLD_BOUNDS: WorldBounds = {
	min: DEFAULT_PHYSICS_PARAMS.yMin,
	max: DEFAULT_PHYSICS_PARAMS.yMax
};

export class GameEngine {
	private config: GameConfig;
	private state: WorldState;
	private rng: () => number;
	private running: boolean;
	private pendingControl: number;
	/** x position where next obstacle should spawn */
	private nextObstacleX: number;
	/** Accumulated real time not yet consumed by fixed-step simulation */
	private accumulator: number;

	constructor(config: Partial<GameConfig> = {}) {
		this.config = { ...DEFAULT_GAME_CONFIG, ...config };
		this.rng = createRng(this.config.seed);
		this.state = createInitialState(this.config.seed);
		this.running = false;
		this.pendingControl = 0;
		this.nextObstacleX = this.config.obstacleConfig.spawnX;
		this.accumulator = 0;
	}

	/** Start (or restart) the simulation. Resets all state. */
	start(): void {
		this.rng = createRng(this.config.seed);
		this.state = createInitialState(this.config.seed);
		this.running = true;
		this.pendingControl = 0;
		this.nextObstacleX = this.config.obstacleConfig.spawnX;
		this.accumulator = 0;
	}

	/** Stop the simulation clock. State is preserved. */
	stop(): void {
		this.running = false;
	}

	/** Set the control force to apply on the next tick(s). */
	setControl(u: number): void {
		this.pendingControl = u;
	}

	/** Get a snapshot of the current world state (read-only copy). */
	getState(): WorldState {
		return {
			...this.state,
			obstacles: this.state.obstacles.map((o) => ({ ...o })),
			physics: { ...this.state.physics }
		};
	}

	/** Whether the simulation is currently running. */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Advance the simulation by a wall-clock delta time.
	 * Uses fixed-dt sub-stepping for determinism and numerical stability.
	 *
	 * @param wallDt - Elapsed wall-clock time since last tick (seconds)
	 */
	tick(wallDt: number): void {
		if (!this.running || !this.state.alive) {
			return;
		}

		this.accumulator += wallDt;

		const dt = this.config.fixedDt;

		// Consume accumulated time in fixed steps
		while (this.accumulator >= dt) {
			this.accumulator -= dt;
			this.stepFixed(dt);

			if (!this.state.alive) {
				this.running = false;
				break;
			}
		}
	}

	/**
	 * Advance exactly one fixed-dt simulation step.
	 * Called internally by tick().
	 */
	private stepFixed(dt: number): void {
		const params = this.config.physicsParams;

		// Step physics
		const newPhysics = stepPhysics(
			this.state.physics,
			this.pendingControl,
			0, // disturbance — future: inject from RNG
			params,
			dt
		);

		// Advance simulation time
		const newTime = this.state.time + dt;

		// Update obstacles: move left
		let obstacles = updateObstacles(
			this.state.obstacles,
			dt,
			this.config.scrollSpeed,
			this.config.obstacleConfig
		);

		// Spawn new obstacle if the rightmost obstacle has scrolled far enough
		const worldBounds: WorldBounds = {
			min: params.yMin,
			max: params.yMax
		};

		// Check if we need to spawn: spawn when the most-recently-spawned obstacle has moved
		// far enough that there's room for the next one.
		const rightmostX =
			obstacles.length > 0
				? Math.max(...obstacles.map((o) => o.x))
				: -Infinity;

		if (rightmostX < this.config.obstacleConfig.spawnX - this.config.obstacleSpacing) {
			const newObstacle = spawnObstacle(this.rng, this.config.obstacleConfig);
			obstacles = [...obstacles, newObstacle];
			this.nextObstacleX = newObstacle.x - this.config.obstacleSpacing;
		}

		// Mark obstacles the bird has passed (bird is at x=0 in world frame)
		const { obstacles: updatedObstacles, newlyPassed } = markPassedObstacles(obstacles, 0);

		// Collision detection
		const collided = checkCollision(
			newPhysics.y,
			this.config.birdRadius,
			updatedObstacles,
			worldBounds,
			this.config.obstacleHalfWidth
		);

		this.state = {
			physics: newPhysics,
			obstacles: updatedObstacles,
			score: this.state.score + newlyPassed,
			time: newTime,
			alive: !collided,
			rngSeed: this.state.rngSeed
		};
	}
}
