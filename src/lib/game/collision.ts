/**
 * Collision detection for the Flappy Bird simulation.
 *
 * The bird is modelled as a circle (sphere in 3D). An obstacle blocks the channel
 * above gapTop and below gapBottom. The world has a floor and ceiling.
 *
 * All functions are pure — no side effects.
 */

import type { Obstacle } from './obstacles.ts';

export interface WorldBounds {
	/** Minimum y position (floor) */
	min: number;
	/** Maximum y position (ceiling) */
	max: number;
}

/**
 * Check whether the bird collides with any obstacle or world boundary.
 *
 * The bird is treated as a point-radius circle at horizontal position zero (world frame).
 * An obstacle at position x causes a collision only when its horizontal span overlaps the bird
 * (i.e. |x| < obstacleHalfWidth + birdRadius).
 *
 * @param birdY - Bird's vertical position (world units)
 * @param birdRadius - Bird collision radius (world units)
 * @param obstacles - Current obstacle list
 * @param bounds - World floor and ceiling
 * @param obstacleHalfWidth - Half-width of obstacle pipes (world units)
 * @returns true if a collision occurred, false otherwise
 */
export function checkCollision(
	birdY: number,
	birdRadius: number,
	obstacles: Obstacle[],
	bounds: WorldBounds,
	obstacleHalfWidth: number = 0.5
): boolean {
	// Check world boundary collisions
	if (birdY - birdRadius <= bounds.min || birdY + birdRadius >= bounds.max) {
		return true;
	}

	// Check each obstacle
	for (const obstacle of obstacles) {
		// Only check obstacles within horizontal collision range
		// Bird is at x=0 in world frame; obstacle spans [x - halfWidth, x + halfWidth]
		const horizontalOverlap = Math.abs(obstacle.x) < obstacleHalfWidth + birdRadius;
		if (!horizontalOverlap) {
			continue;
		}

		// Vertical collision: bird top is above the gap top OR bird bottom is below gap bottom
		const birdTop = birdY + birdRadius;
		const birdBottom = birdY - birdRadius;

		if (birdTop > obstacle.gapTop || birdBottom < obstacle.gapBottom) {
			return true;
		}
	}

	return false;
}
