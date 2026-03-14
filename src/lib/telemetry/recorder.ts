/**
 * Telemetry recorder — stub for Phase 0.
 *
 * Will record time-series data (altitude, velocity, error, control effort, collisions)
 * for display in debug overlays and post-run analysis.
 *
 * Phase 1 implementation target.
 */

export interface TelemetrySample {
	/** Simulation time (s) */
	t: number;
	/** Bird vertical position */
	y: number;
	/** Bird vertical velocity */
	v: number;
	/** Setpoint */
	setpoint: number;
	/** Control error (setpoint - measurement) */
	error: number;
	/** Control output applied */
	control: number;
}

/**
 * Minimal ring-buffer telemetry recorder.
 * Stub: records nothing until Phase 1 is implemented.
 */
export class TelemetryRecorder {
	private samples: TelemetrySample[] = [];
	private maxSamples: number;

	constructor(maxSamples: number = 1000) {
		this.maxSamples = maxSamples;
	}

	record(sample: TelemetrySample): void {
		if (this.samples.length >= this.maxSamples) {
			this.samples.shift();
		}
		this.samples.push(sample);
	}

	getSamples(): readonly TelemetrySample[] {
		return this.samples;
	}

	clear(): void {
		this.samples = [];
	}
}
