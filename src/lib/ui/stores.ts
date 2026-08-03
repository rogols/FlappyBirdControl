/**
 * Svelte stores for global UI state.
 *
 * These stores are the single source of truth for the current game mode,
 * active controller, and run state. Components read and write these stores;
 * the game engine reads from them on each tick.
 */

import { writable } from 'svelte/store';
import type { Controller } from '$lib/control/interfaces';
import type { ActuatorMode } from '$lib/game/actuator';

/** Available game modes */
export type GameMode = 'manual' | 'auto-onoff' | 'auto-pid' | 'auto-tf';

/** Current game mode — determines which controller (if any) drives the bird */
export const gameMode = writable<GameMode>('manual');

/**
 * Current actuator mode — how controller output maps to plant thrust.
 * Shared between game and analysis views so both describe the same loop.
 */
export const actuatorMode = writable<ActuatorMode>('arcade');

/** Active controller instance — null in manual mode or when not configured */
export const activeController = writable<Controller | null>(null);

/** Whether the game simulation is currently running */
export const gameRunning = writable<boolean>(false);
