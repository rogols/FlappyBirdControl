/**
 * Unit tests for TelemetryRecorder ring buffer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryRecorder } from './recorder.ts';
import type { TelemetrySample } from './recorder.ts';

/** Build a minimal valid TelemetrySample at simulation time t. */
function makeSample(t: number, overrides: Partial<TelemetrySample> = {}): TelemetrySample {
	return {
		t,
		y: t * 0.1,
		v: 0,
		setpoint: 5,
		error: 5 - t * 0.1,
		control: 0,
		...overrides
	};
}

describe('TelemetryRecorder — initial state', () => {
	it('starts empty', () => {
		const recorder = new TelemetryRecorder();
		expect(recorder.size).toBe(0);
	});

	it('getHistory returns empty array when no samples recorded', () => {
		const recorder = new TelemetryRecorder();
		expect(recorder.getHistory()).toEqual([]);
	});

	it('getLatest returns null when no samples recorded', () => {
		const recorder = new TelemetryRecorder();
		expect(recorder.getLatest()).toBeNull();
	});
});

describe('TelemetryRecorder — record and retrieve', () => {
	let recorder: TelemetryRecorder;

	beforeEach(() => {
		recorder = new TelemetryRecorder(10);
	});

	it('records a single sample and getLatest returns it', () => {
		const sample = makeSample(1);
		recorder.record(sample);
		expect(recorder.getLatest()).toEqual(sample);
	});

	it('size increments with each record call', () => {
		recorder.record(makeSample(0));
		expect(recorder.size).toBe(1);
		recorder.record(makeSample(1));
		expect(recorder.size).toBe(2);
	});

	it('getHistory returns all samples in chronological order', () => {
		const samples = [makeSample(0), makeSample(1), makeSample(2)];
		for (const s of samples) recorder.record(s);
		const history = recorder.getHistory();
		expect(history).toHaveLength(3);
		expect(history[0].t).toBe(0);
		expect(history[1].t).toBe(1);
		expect(history[2].t).toBe(2);
	});

	it('getHistory(n) returns last n samples', () => {
		for (let i = 0; i < 5; i++) recorder.record(makeSample(i));
		const last2 = recorder.getHistory(2);
		expect(last2).toHaveLength(2);
		expect(last2[0].t).toBe(3);
		expect(last2[1].t).toBe(4);
	});

	it('getHistory(n) returns all when n > count', () => {
		recorder.record(makeSample(0));
		recorder.record(makeSample(1));
		const history = recorder.getHistory(100);
		expect(history).toHaveLength(2);
	});
});

describe('TelemetryRecorder — ring buffer overflow', () => {
	it('size does not exceed maxSamples', () => {
		const recorder = new TelemetryRecorder(5);
		for (let i = 0; i < 20; i++) recorder.record(makeSample(i));
		expect(recorder.size).toBe(5);
	});

	it('oldest samples are overwritten when buffer is full', () => {
		const recorder = new TelemetryRecorder(3);
		recorder.record(makeSample(0));
		recorder.record(makeSample(1));
		recorder.record(makeSample(2));
		// Buffer full: [0, 1, 2]
		recorder.record(makeSample(3));
		// Oldest (t=0) overwritten: should now hold [1, 2, 3]
		const history = recorder.getHistory();
		expect(history).toHaveLength(3);
		expect(history[0].t).toBe(1);
		expect(history[1].t).toBe(2);
		expect(history[2].t).toBe(3);
	});

	it('getLatest returns the most recently written sample after overflow', () => {
		const recorder = new TelemetryRecorder(3);
		for (let i = 0; i < 10; i++) recorder.record(makeSample(i));
		expect(recorder.getLatest()!.t).toBe(9);
	});

	it('getHistory returns chronological order after multiple overflows', () => {
		const recorder = new TelemetryRecorder(3);
		for (let i = 0; i < 9; i++) recorder.record(makeSample(i));
		// After 9 writes to a size-3 buffer the last 3 are [6, 7, 8]
		const history = recorder.getHistory();
		expect(history.map((s) => s.t)).toEqual([6, 7, 8]);
	});
});

describe('TelemetryRecorder — getHistory with partial count after overflow', () => {
	it('getHistory(1) always returns the single latest sample', () => {
		const recorder = new TelemetryRecorder(3);
		for (let i = 0; i < 7; i++) recorder.record(makeSample(i));
		const history = recorder.getHistory(1);
		expect(history).toHaveLength(1);
		expect(history[0].t).toBe(6);
	});

	it('getHistory(2) returns last 2 samples after overflow', () => {
		const recorder = new TelemetryRecorder(3);
		for (let i = 0; i < 7; i++) recorder.record(makeSample(i));
		const history = recorder.getHistory(2);
		expect(history).toHaveLength(2);
		expect(history[0].t).toBe(5);
		expect(history[1].t).toBe(6);
	});
});

describe('TelemetryRecorder — clear', () => {
	it('clear resets size to zero', () => {
		const recorder = new TelemetryRecorder(5);
		for (let i = 0; i < 5; i++) recorder.record(makeSample(i));
		recorder.clear();
		expect(recorder.size).toBe(0);
	});

	it('getHistory returns empty array after clear', () => {
		const recorder = new TelemetryRecorder(5);
		recorder.record(makeSample(0));
		recorder.clear();
		expect(recorder.getHistory()).toEqual([]);
	});

	it('getLatest returns null after clear', () => {
		const recorder = new TelemetryRecorder(5);
		recorder.record(makeSample(0));
		recorder.clear();
		expect(recorder.getLatest()).toBeNull();
	});

	it('can record new samples after clear', () => {
		const recorder = new TelemetryRecorder(3);
		for (let i = 0; i < 3; i++) recorder.record(makeSample(i));
		recorder.clear();
		recorder.record(makeSample(99));
		expect(recorder.size).toBe(1);
		expect(recorder.getLatest()!.t).toBe(99);
	});
});

describe('TelemetryRecorder — default capacity', () => {
	it('default maxSamples is 1200', () => {
		const recorder = new TelemetryRecorder();
		for (let i = 0; i < 1300; i++) recorder.record(makeSample(i));
		expect(recorder.size).toBe(1200);
	});
});
