/**
 * High-score persistence — local storage backed store.
 *
 * Stores per-mode top-10 high scores, sorted by score descending.
 * Each entry includes a snapshot of the controller configuration so students
 * can reproduce a run.
 *
 * Storage key: `fbc.highscores` (see SOFTWARE_DESIGN_PLAN.md §9).
 */

export interface HighScore {
	id: string;
	mode: 'manual' | 'auto-onoff' | 'auto-pid' | 'auto-tf';
	score: number;
	durationSec: number;
	speedMultiplier: number;
	timestamp: string;
	controllerSnapshot: Record<string, unknown>;
}

const STORAGE_KEY = 'fbc.highscores';
/** Maximum entries retained per mode */
const TOP_N_PER_MODE = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load the raw high-score list from localStorage.
 * Returns an empty array if storage is unavailable or the data is malformed.
 */
function loadAll(): HighScore[] {
	if (typeof localStorage === 'undefined') {
		return [];
	}
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw === null) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed as HighScore[];
		}
		return [];
	} catch {
		return [];
	}
}

/**
 * Persist the full high-score list to localStorage.
 */
function persistAll(scores: HighScore[]): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a new high-score entry and persist.
 * Keeps only the top `TOP_N_PER_MODE` entries **per mode**, sorted by score descending.
 */
export function saveHighScore(hs: HighScore): void {
	const all = loadAll();
	all.push(hs);

	// For each mode, keep only the top-N by score.
	const modes = ['manual', 'auto-onoff', 'auto-pid', 'auto-tf'] as const;
	const trimmed: HighScore[] = [];

	for (const mode of modes) {
		const forMode = all
			.filter((entry) => entry.mode === mode)
			.sort((a, b) => b.score - a.score)
			.slice(0, TOP_N_PER_MODE);
		trimmed.push(...forMode);
	}

	persistAll(trimmed);
}

/**
 * Return all stored high scores, optionally filtered to a single mode.
 * Results are sorted by score descending.
 *
 * @param mode - If provided, only return scores for that mode.
 */
export function getHighScores(mode?: HighScore['mode']): HighScore[] {
	const all = loadAll();
	const filtered = mode !== undefined ? all.filter((hs) => hs.mode === mode) : all;
	return filtered.slice().sort((a, b) => b.score - a.score);
}

/**
 * Remove all stored high scores from localStorage.
 */
export function clearHighScores(): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	localStorage.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Legacy helpers kept for internal use (load/save raw list)
// These are not part of the public API described in Phase 1 deliverables,
// but retained so any future tooling that needs raw access can use them.
// ---------------------------------------------------------------------------

/** @internal */
export function loadHighScores(): HighScore[] {
	return loadAll();
}

/** @internal */
export function saveHighScores(scores: HighScore[]): void {
	persistAll(scores);
}

/** @internal */
export function addHighScore(score: HighScore, topN: number = 10): HighScore[] {
	const existing = loadAll();
	const updated = [...existing, score].sort((a, b) => b.score - a.score).slice(0, topN);
	persistAll(updated);
	return updated;
}
