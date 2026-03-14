/**
 * Svelte stores for global UI state.
 *
 * These stores are the single source of truth for the current game mode,
 * active controller, and run state. Components read and write these stores;
 * the game engine reads from them on each tick.
 */

import { writable } from 'svelte/store';
import type { Controller } from '$lib/control/interfaces';

/** Available game modes */
export type GameMode = 'manual' | 'auto-onoff' | 'auto-pid' | 'auto-tf';

/** Current game mode — determines which controller (if any) drives the bird */
export const gameMode = writable<GameMode>('manual');

/** Active controller instance — null in manual mode or when not configured */
export const activeController = writable<Controller | null>(null);

/** Whether the game simulation is currently running */
export const gameRunning = writable<boolean>(false);
