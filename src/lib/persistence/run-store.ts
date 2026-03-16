/**
 * Recent-run persistence — local storage backed store.
 *
 * Saves a summary of each completed game run so students can review and
 * compare performance across controller configurations.
 *
 * Storage key: `fbc.recent-runs` (see SOFTWARE_DESIGN_PLAN.md §9).
 * Maximum entries retained: `MAX_RUNS`.
 */

import type { PerformanceMetrics } from '../telemetry/metrics.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunMode = 'manual' | 'auto-onoff' | 'auto-pid' | 'auto-tf';

export interface RunSummary {
	/** Unique run identifier */
	id: string;
	/** Game mode used for this run */
	mode: RunMode;
	/** Pipes cleared */
	score: number;
	/** Simulated duration (seconds) */
	durationSec: number;
	/** Speed multiplier active during the run */
	speedMultiplier: number;
	/** ISO timestamp when the run ended */
	timestamp: string;
	/** Snapshot of the controller parameters used */
	controllerSnapshot: Record<string, unknown>;
	/** Disturbance force active during the run (N) */
	disturbance: number;
	/** Performance metrics (null for manual mode) */
	metrics: PerformanceMetrics | null;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fbc.recent-runs';
/** Maximum run entries retained in localStorage */
const MAX_RUNS = 50;

function loadAll(): RunSummary[] {
	if (typeof localStorage === 'undefined') return [];
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed as RunSummary[];
		return [];
	} catch {
		return [];
	}
}

function persistAll(runs: RunSummary[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a completed run summary.
 * Oldest entries are dropped when the store exceeds `MAX_RUNS`.
 * Runs are ordered newest-first.
 */
export function saveRun(run: RunSummary): void {
	const existing = loadAll();
	const updated = [run, ...existing].slice(0, MAX_RUNS);
	persistAll(updated);
}

/**
 * Return all stored run summaries, newest first.
 * Optionally filter by mode.
 */
export function getRuns(mode?: RunMode): RunSummary[] {
	const all = loadAll();
	return mode !== undefined ? all.filter((r) => r.mode === mode) : all;
}

/**
 * Return the `n` most recent runs, newest first.
 */
export function getRecentRuns(n: number = 10, mode?: RunMode): RunSummary[] {
	return getRuns(mode).slice(0, n);
}

/**
 * Delete a run by id.
 * No-op if the id is not found.
 */
export function deleteRun(id: string): void {
	const updated = loadAll().filter((r) => r.id !== id);
	persistAll(updated);
}

/**
 * Remove all stored run summaries from localStorage.
 */
export function clearRuns(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(STORAGE_KEY);
}

/**
 * Generate a unique run id.
 */
export function generateRunId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
