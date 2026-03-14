/**
 * Unit tests for high-score persistence store.
 *
 * These tests use a mock localStorage so they run in the Vitest (Node) environment
 * without a real browser.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveHighScore, getHighScores, clearHighScores } from './highscore-store.ts';
import type { HighScore } from './highscore-store.ts';

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

function createLocalStorageMock(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() {
			return store.size;
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null
	};
}

// Replace global localStorage with a fresh mock before each test.
beforeEach(() => {
	const mock = createLocalStorageMock();
	vi.stubGlobal('localStorage', mock);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

let nextId = 1;

function makeScore(overrides: Partial<HighScore> = {}): HighScore {
	return {
		id: String(nextId++),
		mode: 'manual',
		score: 1,
		durationSec: 10,
		speedMultiplier: 1,
		timestamp: '2026-01-01T00:00:00.000Z',
		controllerSnapshot: {},
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getHighScores — empty store', () => {
	it('returns empty array when nothing has been saved', () => {
		expect(getHighScores()).toEqual([]);
	});

	it('returns empty array for a specific mode when nothing has been saved', () => {
		expect(getHighScores('auto-pid')).toEqual([]);
	});
});

describe('saveHighScore — basic persistence', () => {
	it('saves a score and retrieves it', () => {
		const hs = makeScore({ score: 5 });
		saveHighScore(hs);
		const result = getHighScores();
		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(5);
	});

	it('persists multiple scores', () => {
		saveHighScore(makeScore({ score: 3 }));
		saveHighScore(makeScore({ score: 7 }));
		saveHighScore(makeScore({ score: 1 }));
		expect(getHighScores()).toHaveLength(3);
	});
});

describe('getHighScores — sorted by score descending', () => {
	it('returns scores sorted highest first', () => {
		saveHighScore(makeScore({ score: 3 }));
		saveHighScore(makeScore({ score: 10 }));
		saveHighScore(makeScore({ score: 6 }));
		const result = getHighScores();
		expect(result[0].score).toBe(10);
		expect(result[1].score).toBe(6);
		expect(result[2].score).toBe(3);
	});
});

describe('getHighScores — mode filter', () => {
	it('returns only scores for the requested mode', () => {
		saveHighScore(makeScore({ mode: 'manual', score: 5 }));
		saveHighScore(makeScore({ mode: 'auto-pid', score: 8 }));
		saveHighScore(makeScore({ mode: 'auto-onoff', score: 3 }));

		const pidScores = getHighScores('auto-pid');
		expect(pidScores).toHaveLength(1);
		expect(pidScores[0].score).toBe(8);
	});

	it('returns all modes when mode is omitted', () => {
		saveHighScore(makeScore({ mode: 'manual', score: 1 }));
		saveHighScore(makeScore({ mode: 'auto-pid', score: 2 }));
		expect(getHighScores()).toHaveLength(2);
	});

	it('returns empty array when no scores exist for the requested mode', () => {
		saveHighScore(makeScore({ mode: 'manual', score: 5 }));
		expect(getHighScores('auto-tf')).toEqual([]);
	});
});

describe('saveHighScore — top-10 capping per mode', () => {
	it('keeps only the top 10 entries per mode when more than 10 are saved', () => {
		// Save 12 scores for manual mode
		for (let i = 1; i <= 12; i++) {
			saveHighScore(makeScore({ mode: 'manual', score: i }));
		}
		const manualScores = getHighScores('manual');
		expect(manualScores).toHaveLength(10);
		// Top 10 are scores 12 down to 3
		expect(manualScores[0].score).toBe(12);
		expect(manualScores[9].score).toBe(3);
	});

	it('capping is per-mode: does not remove entries from other modes', () => {
		// Fill manual to the cap
		for (let i = 1; i <= 10; i++) {
			saveHighScore(makeScore({ mode: 'manual', score: i }));
		}
		// Add one auto-pid score
		saveHighScore(makeScore({ mode: 'auto-pid', score: 99 }));

		expect(getHighScores('auto-pid')).toHaveLength(1);
		expect(getHighScores('manual')).toHaveLength(10);
	});

	it('a new score that would fall outside top-10 is still saved but trimmed', () => {
		// Save 10 high-scoring entries
		for (let i = 2; i <= 11; i++) {
			saveHighScore(makeScore({ mode: 'manual', score: i }));
		}
		// Save a low-scoring entry (score=1) — should be excluded after trim
		saveHighScore(makeScore({ mode: 'manual', score: 1 }));
		const result = getHighScores('manual');
		expect(result).toHaveLength(10);
		expect(result[9].score).toBe(2); // lowest retained score
	});
});

describe('clearHighScores', () => {
	it('removes all saved scores', () => {
		saveHighScore(makeScore({ score: 5 }));
		saveHighScore(makeScore({ score: 10 }));
		clearHighScores();
		expect(getHighScores()).toEqual([]);
	});

	it('subsequent saves work normally after clear', () => {
		saveHighScore(makeScore({ score: 5 }));
		clearHighScores();
		saveHighScore(makeScore({ score: 3 }));
		const result = getHighScores();
		expect(result).toHaveLength(1);
		expect(result[0].score).toBe(3);
	});
});
