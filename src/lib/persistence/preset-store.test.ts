/**
 * Unit tests for src/lib/persistence/preset-store.ts
 *
 * Validates:
 * - BUILTIN_PRESETS covers all three auto modes
 * - Built-in preset shape: id, label, description, builtIn=true, config
 * - getAllPresets() returns built-ins + user presets
 * - savePreset(): create, retrieve, update (upsert by id)
 * - deletePreset(): removes only the target preset
 * - findPreset(): finds built-in and user presets, returns undefined for unknown id
 * - clearUserPresets(): removes only user presets, leaves built-ins
 * - generatePresetId(): produces non-empty, unique strings
 * - savePreset() silently ignores builtIn=true guard
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	BUILTIN_PRESETS,
	getAllPresets,
	getUserPresets,
	savePreset,
	deletePreset,
	findPreset,
	clearUserPresets,
	generatePresetId
} from './preset-store';
import type { ControllerPreset } from './preset-store';

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
// Helper factories
// ---------------------------------------------------------------------------

function makeUserPID(id = 'user-pid-1'): ControllerPreset {
	return {
		id,
		label: 'My PID',
		description: 'A user-defined PID preset',
		builtIn: false,
		config: {
			mode: 'auto-pid',
			params: { kp: 5, ki: 0.5, kd: 1, filterCoeff: 0.7, outputMin: 0, outputMax: 40 }
		}
	};
}

function makeUserOnOff(id = 'user-onoff-1'): ControllerPreset {
	return {
		id,
		label: 'My OnOff',
		description: 'A user-defined on-off preset',
		builtIn: false,
		config: {
			mode: 'auto-onoff',
			params: { threshold: 0, hysteresis: 0.2, highOutput: 20, lowOutput: 0 }
		}
	};
}

// ---------------------------------------------------------------------------
// BUILTIN_PRESETS
// ---------------------------------------------------------------------------

describe('BUILTIN_PRESETS', () => {
	it('is non-empty', () => {
		expect(BUILTIN_PRESETS.length).toBeGreaterThan(0);
	});

	it('contains at least one preset for each auto mode', () => {
		const modes = ['auto-onoff', 'auto-pid', 'auto-tf'] as const;
		for (const mode of modes) {
			expect(BUILTIN_PRESETS.some((p) => p.config.mode === mode)).toBe(true);
		}
	});

	it('every built-in has builtIn=true', () => {
		for (const p of BUILTIN_PRESETS) {
			expect(p.builtIn).toBe(true);
		}
	});

	it('every built-in has a non-empty id, label, and description', () => {
		for (const p of BUILTIN_PRESETS) {
			expect(p.id.length).toBeGreaterThan(0);
			expect(p.label.length).toBeGreaterThan(0);
			expect(p.description.length).toBeGreaterThan(0);
		}
	});

	it('all built-in ids are unique', () => {
		const ids = BUILTIN_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('PID presets contain valid numeric params', () => {
		for (const p of BUILTIN_PRESETS.filter((p) => p.config.mode === 'auto-pid')) {
			const params = (p.config as unknown as { mode: 'auto-pid'; params: Record<string, number> })
				.params;
			expect(isFinite(params.kp)).toBe(true);
			expect(isFinite(params.ki)).toBe(true);
			expect(isFinite(params.kd)).toBe(true);
		}
	});

	it('TF presets have proper transfer function (deg N ≤ deg D)', () => {
		for (const p of BUILTIN_PRESETS.filter((p) => p.config.mode === 'auto-tf')) {
			const params = (
				p.config as unknown as {
					mode: 'auto-tf';
					params: { numerator: number[]; denominator: number[] };
				}
			).params;
			expect(params.numerator.length).toBeLessThanOrEqual(params.denominator.length);
		}
	});
});

// ---------------------------------------------------------------------------
// getAllPresets / getUserPresets
// ---------------------------------------------------------------------------

describe('getAllPresets', () => {
	it('returns built-ins when no user presets saved', () => {
		const all = getAllPresets();
		expect(all.length).toBe(BUILTIN_PRESETS.length);
	});

	it('includes user presets after save', () => {
		const preset = makeUserPID();
		savePreset(preset);
		const all = getAllPresets();
		expect(all.length).toBe(BUILTIN_PRESETS.length + 1);
		expect(all.some((p) => p.id === preset.id)).toBe(true);
	});

	it('built-ins always come before user presets', () => {
		savePreset(makeUserPID());
		const all = getAllPresets();
		const firstUserIdx = all.findIndex((p) => !p.builtIn);
		const lastBuiltinIdx = all.reduce((acc, p, i) => (p.builtIn ? i : acc), -1);
		expect(firstUserIdx).toBeGreaterThan(lastBuiltinIdx);
	});
});

describe('getUserPresets', () => {
	it('returns empty array initially', () => {
		expect(getUserPresets()).toHaveLength(0);
	});

	it('returns only user presets (no built-ins)', () => {
		savePreset(makeUserPID());
		const user = getUserPresets();
		expect(user.every((p) => !p.builtIn)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// savePreset
// ---------------------------------------------------------------------------

describe('savePreset', () => {
	it('persists a new preset', () => {
		const preset = makeUserPID();
		savePreset(preset);
		expect(getUserPresets()).toHaveLength(1);
		expect(getUserPresets()[0].id).toBe(preset.id);
	});

	it('upserts by id — updates existing preset', () => {
		const preset = makeUserPID();
		savePreset(preset);
		const updated = { ...preset, label: 'Updated Label' };
		savePreset(updated);
		const user = getUserPresets();
		expect(user).toHaveLength(1);
		expect(user[0].label).toBe('Updated Label');
	});

	it('can save multiple presets with different ids', () => {
		savePreset(makeUserPID('pid-a'));
		savePreset(makeUserPID('pid-b'));
		savePreset(makeUserOnOff());
		expect(getUserPresets()).toHaveLength(3);
	});

	it('silently ignores presets with builtIn=true', () => {
		const fakeBuiltin: ControllerPreset = {
			...makeUserPID(),
			builtIn: true
		};
		savePreset(fakeBuiltin);
		expect(getUserPresets()).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// deletePreset
// ---------------------------------------------------------------------------

describe('deletePreset', () => {
	it('removes a user preset by id', () => {
		const preset = makeUserPID();
		savePreset(preset);
		deletePreset(preset.id);
		expect(getUserPresets()).toHaveLength(0);
	});

	it('leaves other user presets intact', () => {
		savePreset(makeUserPID('a'));
		savePreset(makeUserPID('b'));
		deletePreset('a');
		const user = getUserPresets();
		expect(user).toHaveLength(1);
		expect(user[0].id).toBe('b');
	});

	it('is a no-op for unknown id', () => {
		savePreset(makeUserPID());
		deletePreset('no-such-id');
		expect(getUserPresets()).toHaveLength(1);
	});

	it('does not remove built-in presets from getAllPresets', () => {
		const builtinId = BUILTIN_PRESETS[0].id;
		deletePreset(builtinId); // should be silently ignored
		expect(getAllPresets().some((p) => p.id === builtinId)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// findPreset
// ---------------------------------------------------------------------------

describe('findPreset', () => {
	it('finds a built-in preset by id', () => {
		const p = findPreset(BUILTIN_PRESETS[0].id);
		expect(p).toBeDefined();
		expect(p?.id).toBe(BUILTIN_PRESETS[0].id);
	});

	it('finds a user preset by id after save', () => {
		const preset = makeUserPID('find-me');
		savePreset(preset);
		const found = findPreset('find-me');
		expect(found).toBeDefined();
		expect(found?.label).toBe(preset.label);
	});

	it('returns undefined for unknown id', () => {
		expect(findPreset('ghost-id')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// clearUserPresets
// ---------------------------------------------------------------------------

describe('clearUserPresets', () => {
	it('removes all user presets', () => {
		savePreset(makeUserPID('a'));
		savePreset(makeUserPID('b'));
		clearUserPresets();
		expect(getUserPresets()).toHaveLength(0);
	});

	it('built-ins remain after clear', () => {
		savePreset(makeUserPID());
		clearUserPresets();
		expect(getAllPresets().length).toBe(BUILTIN_PRESETS.length);
	});

	it('is safe to call when no user presets exist', () => {
		expect(() => clearUserPresets()).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// generatePresetId
// ---------------------------------------------------------------------------

describe('generatePresetId', () => {
	it('returns a non-empty string', () => {
		expect(generatePresetId().length).toBeGreaterThan(0);
	});

	it('generates unique ids across multiple calls', () => {
		const ids = new Set(Array.from({ length: 20 }, () => generatePresetId()));
		expect(ids.size).toBe(20);
	});
});
