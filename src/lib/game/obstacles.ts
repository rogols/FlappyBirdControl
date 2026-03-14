/**
 * Obstacle generation and management for the Flappy Bird simulation.
 *
 * Obstacles are vertical pipe pairs with a gap the bird must pass through.
 * All functions are pure — no side effects.
 */

export interface Obstacle {
	/** Horizontal position (world units, decreasing as obstacles scroll left) */
	x: number;
	/** Top edge of the gap (world units) — bird must stay below this */
	gapTop: number;
	/** Bottom edge of the gap (world units) — bird must stay above this */
	gapBottom: number;
	/** Whether this obstacle has already been passed (for score counting) */
	passed: boolean;
}

export interface ObstacleConfig {
	/** Horizontal position where new obstacles spawn */
	spawnX: number;
	/** Minimum gap size (world units) */
	minGapSize: number;
	/** Maximum gap size (world units) */
	maxGapSize: number;
	/** Minimum bottom edge of gap (world units) — keeps gap above floor */
	minGapBottom: number;
	/** Maximum bottom edge of gap (world units) — keeps gap below ceiling */
	maxGapBottom: number;
	/** x position below which obstacles are removed (off-screen left) */
	removeX: number;
}

export const DEFAULT_OBSTACLE_CONFIG: ObstacleConfig = {
	spawnX: 15.0,
	minGapSize: 2.5,
	maxGapSize: 4.0,
	minGapBottom: 1.0,
	maxGapBottom: 6.5,
	removeX: -2.0
};

/**
 * Spawn a new obstacle at the configured spawn position with a randomly placed gap.
 *
 * @param rng - Seeded RNG function (must NOT be Math.random)
 * @param config - Obstacle generation configuration
 * @returns New obstacle ready to be added to the world
 */
export function spawnObstacle(rng: () => number, config: ObstacleConfig): Obstacle {
	// Determine gap size: lerp between min and max using RNG
	const gapSize = config.minGapSize + rng() * (config.maxGapSize - config.minGapSize);

	// Determine gap bottom position within allowed range
	const gapBottom = config.minGapBottom + rng() * (config.maxGapBottom - config.minGapBottom);
	const gapTop = gapBottom + gapSize;

	return {
		x: config.spawnX,
		gapTop,
		gapBottom,
		passed: false
	};
}

/**
 * Advance all obstacles one time step: move them left at the given scroll speed,
 * then remove any that have scrolled off the left edge.
 *
 * @param obstacles - Current list of obstacles
 * @param dt - Time step (seconds)
 * @param speed - Horizontal scroll speed (world units / second), positive = rightward world
 * @param config - Obstacle config (for removeX threshold)
 * @returns New list of obstacles with updated positions, off-screen ones removed
 */
export function updateObstacles(
	obstacles: Obstacle[],
	dt: number,
	speed: number,
	config: ObstacleConfig
): Obstacle[] {
	return obstacles
		.map((obstacle) => ({
			...obstacle,
			x: obstacle.x - speed * dt
		}))
		.filter((obstacle) => obstacle.x > config.removeX);
}

/**
 * Mark obstacles as passed when the bird's x position (typically 0) has cleared them.
 * Returns updated obstacle list and the count of newly passed obstacles (for scoring).
 *
 * @param obstacles - Current list of obstacles
 * @param birdX - Bird's horizontal position (world units)
 * @returns Object with updated obstacles and number of newly passed obstacles
 */
export function markPassedObstacles(
	obstacles: Obstacle[],
	birdX: number
): { obstacles: Obstacle[]; newlyPassed: number } {
	let newlyPassed = 0;
	const updated = obstacles.map((obstacle) => {
		if (!obstacle.passed && obstacle.x < birdX) {
			newlyPassed++;
			return { ...obstacle, passed: true };
		}
		return obstacle;
	});
	return { obstacles: updated, newlyPassed };
}
