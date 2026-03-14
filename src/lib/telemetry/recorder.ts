/**
 * Telemetry recorder — fixed-size ring buffer for time-series data.
 *
 * Records altitude, velocity, error, and control effort per simulation frame.
 * Used by debug overlays and post-run analysis views.
 *
 * Ring buffer semantics: when full, the oldest sample is overwritten.
 * The buffer never allocates beyond `maxSamples` entries after construction.
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
 * Fixed-capacity ring buffer telemetry recorder.
 *
 * Default capacity: 1200 samples ≈ 20 s at 60 Hz.
 * Oldest samples are overwritten when the buffer is full.
 */
export class TelemetryRecorder {
	/** Pre-allocated buffer array */
	private buffer: Array<TelemetrySample | undefined>;
	/** Index where the next write will go */
	private writeIndex: number;
	/** How many valid samples are currently stored (≤ maxSamples) */
	private count: number;
	/** Maximum number of samples the buffer can hold */
	private readonly maxSamples: number;

	constructor(maxSamples: number = 1200) {
		this.maxSamples = maxSamples;
		this.buffer = new Array<TelemetrySample | undefined>(maxSamples).fill(undefined);
		this.writeIndex = 0;
		this.count = 0;
	}

	/**
	 * Record one sample. If the buffer is full the oldest entry is overwritten.
	 */
	record(sample: TelemetrySample): void {
		this.buffer[this.writeIndex] = sample;
		this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
		if (this.count < this.maxSamples) {
			this.count++;
		}
	}

	/**
	 * Return the last `n` samples in chronological order (oldest first).
	 * If `n` is omitted or larger than the number of stored samples, all samples are returned.
	 */
	getHistory(n?: number): TelemetrySample[] {
		if (this.count === 0) {
			return [];
		}

		const limit = n !== undefined ? Math.min(n, this.count) : this.count;

		// The oldest sample in the ring sits at `writeIndex` when the buffer is full,
		// or at index 0 when it is not yet full (writeIndex === count in that case).
		const oldestIndex = this.count < this.maxSamples ? 0 : this.writeIndex;

		const result: TelemetrySample[] = [];

		// Skip the first (count - limit) samples so we get the last `limit` samples.
		const skip = this.count - limit;

		for (let i = skip; i < this.count; i++) {
			const bufferIndex = (oldestIndex + i) % this.maxSamples;
			const sample = this.buffer[bufferIndex];
			if (sample !== undefined) {
				result.push(sample);
			}
		}

		return result;
	}

	/**
	 * Return the most recently recorded sample, or null if no samples have been recorded.
	 */
	getLatest(): TelemetrySample | null {
		if (this.count === 0) {
			return null;
		}
		// writeIndex points to the next write slot; one behind it is the latest sample.
		const latestIndex = (this.writeIndex - 1 + this.maxSamples) % this.maxSamples;
		return this.buffer[latestIndex] ?? null;
	}

	/**
	 * Clear all recorded samples and reset the buffer to empty.
	 */
	clear(): void {
		this.buffer.fill(undefined);
		this.writeIndex = 0;
		this.count = 0;
	}

	/** Total number of samples currently stored in the buffer. */
	get size(): number {
		return this.count;
	}
}
