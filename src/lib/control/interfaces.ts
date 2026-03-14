/**
 * Core controller interface.
 *
 * All controllers — On-Off, PID, transfer-function — must implement this contract.
 * Do not change without discussion (shared between game runtime and analysis module).
 */
export interface Controller {
	reset(initialState?: unknown): void;
	update(input: { t: number; dt: number; setpoint: number; measurement: number }): {
		control: number;
		internals?: Record<string, number>;
	};
}
