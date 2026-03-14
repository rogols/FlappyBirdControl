/**
 * High-score persistence — local storage backed store.
 *
 * Stub for Phase 0. Full implementation in Phase 1.
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

/**
 * Load high scores from local storage.
 * Returns an empty array if nothing is stored or storage is unavailable.
 */
export function loadHighScores(): HighScore[] {
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
 * Save high scores to local storage.
 */
export function saveHighScores(scores: HighScore[]): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}

/**
 * Add a new score entry and persist. Keeps only the top N entries per mode.
 */
export function addHighScore(score: HighScore, topN: number = 10): HighScore[] {
	const existing = loadHighScores();
	const updated = [...existing, score].sort((a, b) => b.score - a.score).slice(0, topN);
	saveHighScores(updated);
	return updated;
}
