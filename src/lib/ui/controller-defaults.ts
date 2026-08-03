/**
 * Default controller construction per game mode and actuator mode.
 *
 * Output limits are always derived from the actuator model so the controller
 * clamp and the plant saturation can never disagree. Controller gains are
 * intentionally identical in arcade and lab mode — comparing the same tuning
 * under the two actuator interpretations is the lesson.
 */

import { OnOffController } from '$lib/control/onoff-controller';
import { PIDController } from '$lib/control/pid-controller';
import { TFController, DEFAULT_TF_PARAMS } from '$lib/control/tf-controller';
import type { Controller } from '$lib/control/interfaces';
import type { ActuatorModel } from '$lib/game/actuator';
import type { GameMode } from './stores.ts';

/** Default PID gains used by the game (same in both actuator modes). */
export const GAME_PID_GAINS = { kp: 8, ki: 1, kd: 2 } as const;

/**
 * On-Off output levels per actuator mode. Arcade switches between a strong
 * upward burst and free fall; lab switches symmetrically around hover, which
 * produces the classic relay limit cycle on the double integrator.
 */
export const GAME_ONOFF_LEVELS = {
	arcade: { highOutput: 30, lowOutput: 0 },
	lab: { highOutput: 6, lowOutput: -6 }
} as const;

/**
 * Create the default controller for a game mode, clamped to the actuator's
 * output range. Returns null for manual mode.
 *
 * @param mode - Game mode
 * @param actuator - Actuator model providing output limits
 * @param existing - Currently active controller (e.g. applied from the
 *                   analysis view); a TFController is reused when its limits
 *                   already match, otherwise rebuilt with the same C(s).
 */
export function createControllerForMode(
	mode: GameMode,
	actuator: ActuatorModel,
	existing: Controller | null = null
): Controller | null {
	switch (mode) {
		case 'auto-onoff': {
			const levels = GAME_ONOFF_LEVELS[actuator.mode];
			return new OnOffController({ ...levels, threshold: 0, hysteresis: 0.3 });
		}
		case 'auto-pid':
			return new PIDController({
				...GAME_PID_GAINS,
				outputMin: actuator.outputMin,
				outputMax: actuator.outputMax
			});
		case 'auto-tf': {
			if (existing instanceof TFController) {
				const params = existing.getParams();
				if (params.outputMin === actuator.outputMin && params.outputMax === actuator.outputMax) {
					return existing;
				}
				return new TFController({
					...params,
					outputMin: actuator.outputMin,
					outputMax: actuator.outputMax
				});
			}
			return new TFController({
				...DEFAULT_TF_PARAMS,
				outputMin: actuator.outputMin,
				outputMax: actuator.outputMax
			});
		}
		default:
			return null;
	}
}
