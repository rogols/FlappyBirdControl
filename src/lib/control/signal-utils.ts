/**
 * Signal utility functions for controller implementations.
 *
 * Pure functions only — no side effects.
 */

/**
 * Clamp a value to the given inclusive range.
 *
 * @param value - Input value
 * @param min - Minimum bound (inclusive)
 * @param max - Maximum bound (inclusive)
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Apply a first-order low-pass filter (exponential moving average).
 *
 * y_k = alpha * y_{k-1} + (1 - alpha) * x_k
 *
 * @param previous - Previous filtered value
 * @param current - Current raw value
 * @param alpha - Filter coefficient in [0, 1). 0 = no filtering, close to 1 = heavy filtering
 * @returns New filtered value
 */
export function lowPassFilter(previous: number, current: number, alpha: number): number {
	return alpha * previous + (1 - alpha) * current;
}

/**
 * Compute a finite-difference derivative estimate with optional low-pass filter.
 *
 * @param currentValue - Current signal value
 * @param previousValue - Previous signal value
 * @param dt - Time step (s), must be positive
 * @param previousDerivative - Previously filtered derivative
 * @param filterCoeff - Filter coefficient in [0, 1)
 * @returns Filtered derivative estimate
 */
export function filteredDerivative(
	currentValue: number,
	previousValue: number,
	dt: number,
	previousDerivative: number,
	filterCoeff: number
): number {
	const rawDerivative = (currentValue - previousValue) / dt;
	return lowPassFilter(previousDerivative, rawDerivative, filterCoeff);
}
