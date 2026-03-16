/**
 * Controller preset persistence — local storage backed store.
 *
 * A preset captures a controller type and its parameters so students can
 * save, load, and share tuning configurations.  Built-in classroom presets
 * are always available and cannot be deleted.
 *
 * Storage key: `fbc.controller-presets` (see SOFTWARE_DESIGN_PLAN.md §9).
 */

import type { OnOffParams } from '../control/onoff-controller.ts';
import type { PIDParams } from '../control/pid-controller.ts';
import type { TFControllerParams } from '../control/tf-controller.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PresetMode = 'auto-onoff' | 'auto-pid' | 'auto-tf';

export interface OnOffPreset {
	mode: 'auto-onoff';
	params: OnOffParams;
}

export interface PIDPreset {
	mode: 'auto-pid';
	params: PIDParams;
}

export interface TFPreset {
	mode: 'auto-tf';
	params: TFControllerParams;
}

export type PresetConfig = OnOffPreset | PIDPreset | TFPreset;

export interface ControllerPreset {
	/** Unique identifier (UUID v4 for user presets, fixed string for built-ins) */
	id: string;
	/** Human-readable name shown in the UI */
	label: string;
	/** Brief pedagogical description shown as tooltip / sub-label */
	description: string;
	/** Whether this preset ships with the application (cannot be deleted) */
	builtIn: boolean;
	/** Controller type and parameters */
	config: PresetConfig;
}

// ---------------------------------------------------------------------------
// Built-in classroom presets
// ---------------------------------------------------------------------------

/** On-Off: wide hysteresis → slow, lazy oscillation. Good for limit cycle demo. */
const ONOFF_SLOW: ControllerPreset = {
	id: 'builtin-onoff-slow',
	label: 'On-Off — Slow Oscillation',
	description:
		'Wide hysteresis band (±0.5 m) produces a gentle, slow limit cycle. ' +
		'Great for introducing bang-bang control and its inherent oscillation.',
	builtIn: true,
	config: {
		mode: 'auto-onoff',
		params: { threshold: 0, hysteresis: 0.5, highOutput: 18, lowOutput: 0 }
	}
};

/** On-Off: tight hysteresis → fast chattering. Shows chattering problem. */
const ONOFF_CHATTER: ControllerPreset = {
	id: 'builtin-onoff-chatter',
	label: 'On-Off — Chattering',
	description:
		'Near-zero hysteresis (±0.05 m) causes rapid switching — the classic chattering problem. ' +
		'Compare energy use vs. the slow-oscillation preset.',
	builtIn: true,
	config: {
		mode: 'auto-onoff',
		params: { threshold: 0, hysteresis: 0.05, highOutput: 18, lowOutput: 0 }
	}
};

/** PID: conservative beginner tuning — stable but sluggish. */
const PID_BEGINNER: ControllerPreset = {
	id: 'builtin-pid-beginner',
	label: 'PID — Stable Beginner',
	description:
		'Low gains (Kp=4, Ki=0, Kd=0.5) give a sluggish but stable response with no overshoot. ' +
		'Good starting point before students tune aggressively.',
	builtIn: true,
	config: {
		mode: 'auto-pid',
		params: { kp: 4, ki: 0, kd: 0.5, filterCoeff: 0.7, outputMin: 0, outputMax: 40 }
	}
};

/** PID: well-tuned — fast settling with acceptable overshoot. */
const PID_TUNED: ControllerPreset = {
	id: 'builtin-pid-tuned',
	label: 'PID — Well Tuned',
	description:
		'Balanced gains (Kp=8, Ki=1, Kd=2) give fast settling and good disturbance rejection. ' +
		'The reference design for this plant.',
	builtIn: true,
	config: {
		mode: 'auto-pid',
		params: { kp: 8, ki: 1, kd: 2, filterCoeff: 0.7, outputMin: 0, outputMax: 40 }
	}
};

/** PID: aggressive — fast but oscillatory. Shows trade-off between speed and stability margin. */
const PID_AGGRESSIVE: ControllerPreset = {
	id: 'builtin-pid-aggressive',
	label: 'PID — Aggressive',
	description:
		'High gains (Kp=20, Ki=3, Kd=5) give the fastest response but with visible oscillation. ' +
		'Demonstrates reduced stability margin and integral windup risk.',
	builtIn: true,
	config: {
		mode: 'auto-pid',
		params: { kp: 20, ki: 3, kd: 5, filterCoeff: 0.5, outputMin: 0, outputMax: 40 }
	}
};

/** TF: filtered PD — default transfer function controller. */
const TF_FILTERED_PD: ControllerPreset = {
	id: 'builtin-tf-filtered-pd',
	label: 'TF — Filtered PD (default)',
	description:
		'C(s) = (2s+8)/(0.05s+1): a PD controller with a first-order noise filter. ' +
		'Proper, stable, and equivalent to the tuned PID without integral action.',
	builtIn: true,
	config: {
		mode: 'auto-tf',
		params: {
			numerator: [2, 8],
			denominator: [0.05, 1],
			dt: 1 / 60,
			outputMin: 0,
			outputMax: 40
		}
	}
};

/** All built-in presets in display order */
export const BUILTIN_PRESETS: ControllerPreset[] = [
	ONOFF_SLOW,
	ONOFF_CHATTER,
	PID_BEGINNER,
	PID_TUNED,
	PID_AGGRESSIVE,
	TF_FILTERED_PD
];

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fbc.controller-presets';

function loadUserPresets(): ControllerPreset[] {
	if (typeof localStorage === 'undefined') return [];
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed as ControllerPreset[];
		return [];
	} catch {
		return [];
	}
}

function persistUserPresets(presets: ControllerPreset[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all presets: built-ins first, then user-saved presets.
 */
export function getAllPresets(): ControllerPreset[] {
	return [...BUILTIN_PRESETS, ...loadUserPresets()];
}

/**
 * Return only user-saved presets (excluding built-ins).
 */
export function getUserPresets(): ControllerPreset[] {
	return loadUserPresets();
}

/**
 * Save a user preset.  If a preset with the same `id` already exists it is
 * replaced; otherwise the preset is appended.
 *
 * Built-in preset IDs are rejected — the caller should generate a new UUID.
 */
export function savePreset(preset: ControllerPreset): void {
	if (preset.builtIn) return; // guard: never overwrite built-ins via this path
	const existing = loadUserPresets();
	const idx = existing.findIndex((p) => p.id === preset.id);
	if (idx >= 0) {
		existing[idx] = preset;
	} else {
		existing.push(preset);
	}
	persistUserPresets(existing);
}

/**
 * Delete a user preset by id.
 * Built-in presets are silently ignored.
 */
export function deletePreset(id: string): void {
	const existing = loadUserPresets().filter((p) => p.id !== id);
	persistUserPresets(existing);
}

/**
 * Find a preset by id (built-ins included).
 * Returns `undefined` if not found.
 */
export function findPreset(id: string): ControllerPreset | undefined {
	return getAllPresets().find((p) => p.id === id);
}

/**
 * Remove all user-saved presets from localStorage.
 * Built-in presets are unaffected.
 */
export function clearUserPresets(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(STORAGE_KEY);
}

/**
 * Generate a simple unique id for user presets.
 * Uses crypto.randomUUID when available, falls back to a timestamp+random string.
 */
export function generatePresetId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
