/**
 * Unit tests for src/lib/persistence/run-store.ts
 *
 * Validates:
 * - saveRun / getRuns / getRecentRuns / deleteRun / clearRuns
 * - MAX_RUNS eviction (oldest entries dropped)
 * - Mode filter in getRuns / getRecentRuns
 * - generateRunId uniqueness
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveRun, getRuns, getRecentRuns, deleteRun, clearRuns, generateRunId } from './run-store';
import type { RunSummary } from './run-store';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function makeLocalStorageMock() {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((index: number) => Object.keys(store)[index] ?? null)
	};
}

const localStorageMock = makeLocalStorageMock();

beforeEach(() => {
	localStorageMock.clear();
	vi.stubGlobal('localStorage', localStorageMock);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeRun(overrides: Partial<RunSummary> & { mode?: RunSummary['mode'] } = {}): RunSummary {
	idCounter++;
	return {
		id: `test-run-${idCounter}`,
		mode: 'auto-pid',
		score: idCounter * 3,
		durationSec: 10 + idCounter,
		speedMultiplier: 1,
		timestamp: new Date(1_000_000 + idCounter * 1000).toISOString(),
		controllerSnapshot: {},
		disturbance: 0,
		metrics: null,
		...overrides
	};
}

// ---------------------------------------------------------------------------
// saveRun / getRuns
// ---------------------------------------------------------------------------

describe('saveRun / getRuns', () => {
	it('returns empty array initially', () => {
		expect(getRuns()).toHaveLength(0);
	});

	it('saves and retrieves a run', () => {
		const run = makeRun();
		saveRun(run);
		const runs = getRuns();
		expect(runs).toHaveLength(1);
		expect(runs[0].id).toBe(run.id);
	});

	it('stores runs newest-first', () => {
		const r1 = makeRun();
		const r2 = makeRun();
		saveRun(r1);
		saveRun(r2);
		const runs = getRuns();
		expect(runs[0].id).toBe(r2.id);
		expect(runs[1].id).toBe(r1.id);
	});

	it('filters by mode', () => {
		saveRun(makeRun({ mode: 'auto-pid' }));
		saveRun(makeRun({ mode: 'auto-onoff' }));
		saveRun(makeRun({ mode: 'auto-pid' }));

		expect(getRuns('auto-pid')).toHaveLength(2);
		expect(getRuns('auto-onoff')).toHaveLength(1);
		expect(getRuns('manual')).toHaveLength(0);
	});

	it('returns all runs when mode is omitted', () => {
		saveRun(makeRun({ mode: 'auto-pid' }));
		saveRun(makeRun({ mode: 'manual' }));
		expect(getRuns()).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// MAX_RUNS eviction
// ---------------------------------------------------------------------------

describe('saveRun — MAX_RUNS eviction', () => {
	it('retains at most MAX_RUNS (50) entries', () => {
		for (let i = 0; i < 55; i++) {
			saveRun(makeRun());
		}
		expect(getRuns().length).toBeLessThanOrEqual(50);
	});

	it('drops oldest entries when over limit', () => {
		const first = makeRun();
		saveRun(first);
		for (let i = 0; i < 50; i++) {
			saveRun(makeRun());
		}
		const runs = getRuns();
		expect(runs.some((r) => r.id === first.id)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// getRecentRuns
// ---------------------------------------------------------------------------

describe('getRecentRuns', () => {
	it('returns the n most recent runs', () => {
		for (let i = 0; i < 10; i++) saveRun(makeRun());
		expect(getRecentRuns(3)).toHaveLength(3);
	});

	it('returns fewer than n when not enough runs exist', () => {
		saveRun(makeRun());
		saveRun(makeRun());
		expect(getRecentRuns(5)).toHaveLength(2);
	});

	it('filters by mode when provided', () => {
		saveRun(makeRun({ mode: 'auto-pid' }));
		saveRun(makeRun({ mode: 'auto-onoff' }));
		saveRun(makeRun({ mode: 'auto-pid' }));
		expect(getRecentRuns(10, 'auto-pid')).toHaveLength(2);
		expect(getRecentRuns(10, 'auto-tf')).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// deleteRun
// ---------------------------------------------------------------------------

describe('deleteRun', () => {
	it('removes a run by id', () => {
		const run = makeRun();
		saveRun(run);
		deleteRun(run.id);
		expect(getRuns()).toHaveLength(0);
	});

	it('leaves other runs intact', () => {
		const r1 = makeRun();
		const r2 = makeRun();
		saveRun(r1);
		saveRun(r2);
		deleteRun(r1.id);
		const runs = getRuns();
		expect(runs).toHaveLength(1);
		expect(runs[0].id).toBe(r2.id);
	});

	it('is a no-op for unknown id', () => {
		saveRun(makeRun());
		deleteRun('ghost-id');
		expect(getRuns()).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// clearRuns
// ---------------------------------------------------------------------------

describe('clearRuns', () => {
	it('removes all runs', () => {
		saveRun(makeRun());
		saveRun(makeRun());
		clearRuns();
		expect(getRuns()).toHaveLength(0);
	});

	it('is safe to call when store is empty', () => {
		expect(() => clearRuns()).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// generateRunId
// ---------------------------------------------------------------------------

describe('generateRunId', () => {
	it('returns a non-empty string', () => {
		expect(generateRunId().length).toBeGreaterThan(0);
	});

	it('produces unique ids', () => {
		const ids = new Set(Array.from({ length: 20 }, () => generateRunId()));
		expect(ids.size).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// Metrics field round-trip
// ---------------------------------------------------------------------------

describe('metrics field round-trip', () => {
	it('preserves null metrics for manual runs', () => {
		const run = makeRun({ mode: 'manual', metrics: null });
		saveRun(run);
		const saved = getRuns()[0];
		expect(saved.metrics).toBeNull();
	});

	it('preserves non-null metrics for auto runs', () => {
		const metrics = {
			ise: 12.34,
			iae: 5.67,
			itae: 2.11,
			peakError: 1.5,
			settleTimeSec: 3.2,
			totalEffort: 100,
			durationSec: 10,
			sampleCount: 600
		};
		const run = makeRun({ metrics });
		saveRun(run);
		const saved = getRuns()[0];
		expect(saved.metrics).toEqual(metrics);
	});
});
