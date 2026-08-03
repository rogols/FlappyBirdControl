/**
 * Setpoint schedule — deterministic reference signal for the closed loop.
 *
 * Provides the target altitude as a pure function of simulation time, so runs
 * are reproducible (fixed Δt + seeded RNG + this schedule fully determine a
 * run). A `square` schedule injects periodic step changes — each jump is a
 * live step input, making overshoot, oscillation, and settling directly
 * observable during play.
 *
 * Pure functions only. No side effects, no stored state.
 */

export interface SetpointScheduleConfig {
	/** `constant` holds baseLevel forever; `square` alternates between levels. */
	kind: 'constant' | 'square';
	/** Level held before the first step and by `constant` schedules (world units). */
	baseLevel: number;
	/**
	 * Alternating levels for the `square` schedule (world units).
	 * The first hold after `startDelaySec` is `levels[0]`, then `levels[1]`, …
	 */
	levels: [number, number];
	/** How long each level is held (s). Must be positive. */
	holdSec: number;
	/** Time spent at baseLevel before the first step (s), letting the loop settle. */
	startDelaySec: number;
}

/**
 * Default: settle at mid-height for 3 s, then alternate 5.5 / 4.5 every 6 s.
 *
 * The ±0.5 m levels give 1 m steps: with the default lab-mode PID (Kp = 8)
 * the proportional term Kp·|step| = 8 N stays inside the ±9.81 N lab clamp,
 * so the step response is essentially linear and matches the analysis view.
 * A 6 s hold covers the predicted ≈ 4.7 s settling time of the default gains.
 */
export const DEFAULT_SETPOINT_SCHEDULE: SetpointScheduleConfig = {
	kind: 'square',
	baseLevel: 5.0,
	levels: [5.5, 4.5],
	holdSec: 6.0,
	startDelaySec: 3.0
};

/**
 * Evaluate the schedule at simulation time `t` (seconds since run start).
 */
export function setpointAt(config: SetpointScheduleConfig, t: number): number {
	if (config.kind === 'constant' || t < config.startDelaySec) {
		return config.baseLevel;
	}
	const intervalIndex = Math.floor((t - config.startDelaySec) / config.holdSec);
	return config.levels[intervalIndex % 2];
}
