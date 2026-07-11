/**
 * Mode configuration — metadata and defaults for each game mode.
 *
 * Provides display labels, descriptions, and factory functions for each mode's
 * default controller. Used by the mode selector UI component.
 */

import type { GameMode } from './stores.ts';
import type { ActuatorMode } from '$lib/game/actuator';

export interface ModeConfig {
	/** Short display label */
	label: string;
	/** One-sentence description for UI tooltips */
	description: string;
	/** Whether this mode uses an automatic controller */
	isAutomatic: boolean;
}

export const MODE_CONFIGS: Record<GameMode, ModeConfig> = {
	manual: {
		label: 'Manual',
		description: 'Control the bird yourself using the spacebar or tap.',
		isAutomatic: false
	},
	'auto-onoff': {
		label: 'On-Off',
		description: 'Bang-bang controller switches between full thrust and no thrust.',
		isAutomatic: true
	},
	'auto-pid': {
		label: 'PID',
		description: 'Proportional-Integral-Derivative controller tracks the setpoint height.',
		isAutomatic: true
	},
	'auto-tf': {
		label: 'Transfer Function',
		description: 'Custom discrete-time transfer function controller C(z).',
		isAutomatic: true
	}
};

export interface ActuatorConfig {
	/** Short display label */
	label: string;
	/** One-sentence description for UI tooltips */
	description: string;
	/** Whether pipe obstacles are spawned in this actuator mode */
	spawnObstacles: boolean;
}

export const ACTUATOR_CONFIGS: Record<ActuatorMode, ActuatorConfig> = {
	arcade: {
		label: 'Arcade',
		description:
			'One-sided thrust (0–40 N): the controller can only push up; gravity pulls down. ' +
			'The authentic game feel, but the response is asymmetric.',
		spawnObstacles: true
	},
	lab: {
		label: 'Lab',
		description:
			'Symmetric thrust around hover (±9.8 N about m·g): the loop matches the linear ' +
			'analysis model, so textbook overshoot and oscillation are visible. No pipes — ' +
			'pure setpoint tracking, scored by control metrics.',
		spawnObstacles: false
	}
};
