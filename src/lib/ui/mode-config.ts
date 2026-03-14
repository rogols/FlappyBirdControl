/**
 * Mode configuration — metadata and defaults for each game mode.
 *
 * Provides display labels, descriptions, and factory functions for each mode's
 * default controller. Used by the mode selector UI component.
 */

import type { GameMode } from './stores.ts';

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
