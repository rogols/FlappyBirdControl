/**
 * On-Off (bang-bang) controller with hysteresis.
 *
 * Switches between highOutput and lowOutput based on the error signal.
 * Hysteresis prevents rapid switching (chattering) near the threshold.
 *
 * State machine:
 *   - When error > threshold + hysteresis: switch to HIGH output
 *   - When error < threshold - hysteresis: switch to LOW output
 *   - Between those bands: hold current output
 *
 * Pure controller logic — no rendering or side effects.
 */

import type { Controller } from './interfaces.ts';

export interface OnOffParams {
	/** Error magnitude at which output switches. Default: 0 */
	threshold: number;
	/** Half-width of hysteresis band around threshold. Default: 0 */
	hysteresis: number;
	/** Control output when error is above threshold (high effort). Default: 1 */
	highOutput: number;
	/** Control output when error is below threshold (low effort). Default: 0 */
	lowOutput: number;
}

export const DEFAULT_ONOFF_PARAMS: OnOffParams = {
	threshold: 0,
	hysteresis: 0.1,
	highOutput: 1.0,
	lowOutput: 0.0
};

/**
 * Internal state for the on-off controller.
 * Tracks whether high or low output is currently active.
 */
interface OnOffState {
	isHigh: boolean;
}

export class OnOffController implements Controller {
	private params: OnOffParams;
	private state: OnOffState;

	constructor(params: Partial<OnOffParams> = {}) {
		this.params = { ...DEFAULT_ONOFF_PARAMS, ...params };
		this.state = { isHigh: false };
	}

	reset(initialState?: unknown): void {
		if (
			initialState !== null &&
			initialState !== undefined &&
			typeof initialState === 'object' &&
			'isHigh' in initialState &&
			typeof (initialState as { isHigh: unknown }).isHigh === 'boolean'
		) {
			this.state = { isHigh: (initialState as { isHigh: boolean }).isHigh };
		} else {
			this.state = { isHigh: false };
		}
	}

	update(input: { t: number; dt: number; setpoint: number; measurement: number }): {
		control: number;
		internals?: Record<string, number>;
	} {
		const error = input.setpoint - input.measurement;
		const { threshold, hysteresis, highOutput, lowOutput } = this.params;

		// Apply hysteresis: only switch state when error clearly crosses the threshold bands
		if (error > threshold + hysteresis) {
			this.state.isHigh = true;
		} else if (error < threshold - hysteresis) {
			this.state.isHigh = false;
		}
		// else: error is within hysteresis band — hold current state

		const control = this.state.isHigh ? highOutput : lowOutput;

		return {
			control,
			internals: {
				error,
				isHigh: this.state.isHigh ? 1 : 0,
				threshold,
				hysteresis
			}
		};
	}
}
