import { expect, test } from '@playwright/test';

/**
 * E2E: lab actuator mode, setpoint steps, and the closed-loop theory bridge.
 *
 * Uses 8x simulation speed so a multi-step run completes in a few wall-clock
 * seconds. Assertions are DOM-based (badges, readouts, SVG paths) — chart
 * pixels are not inspected.
 */

/**
 * Select the PID game mode, retrying until the auto-mode controls appear.
 * The page is server-rendered, so a change event fired before hydration
 * completes is silently lost — retry until the UI reacts.
 */
async function selectPidMode(page: import('@playwright/test').Page): Promise<void> {
	await expect(async () => {
		await page.locator('select').first().selectOption('auto-pid');
		await expect(page.getByTestId('actuator-lab')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15000 });
}

test.describe('game page — actuator modes and setpoint steps', () => {
	test('lab mode runs a step schedule and reports step metrics on Stop', async ({ page }) => {
		await page.goto('/game');

		// Switch to PID mode; actuator controls appear for auto modes
		await selectPidMode(page);
		await page.getByTestId('actuator-lab').click();

		// Steps is the default setpoint source — verify the toggle is present
		await expect(page.getByTestId('setpoint-steps')).toBeVisible();

		await page.getByRole('button', { name: 'Start' }).click();
		await page.getByRole('button', { name: '8x' }).click();

		// The schedule steps to 5.5 m after 3 s of sim time (< 1 s wall at 8x)
		await expect(page.getByTestId('setpoint-readout')).toHaveText(/SP: 5\.5 m/, {
			timeout: 15000
		});

		// Let at least two full steps play out (t > 15 s sim ≈ 2 s wall at 8x)
		await expect(page.getByTestId('setpoint-readout')).toHaveText(/SP: 4\.5 m/, {
			timeout: 15000
		});

		// Lab mode spawns no pipes, so the run is still alive — stop it
		await page.getByRole('button', { name: 'Stop' }).click();

		// The run report shows a numeric overshoot (not the em-dash placeholder)
		await expect(page.getByTestId('run-report')).toBeVisible();
		await expect(page.getByTestId('overshoot-value')).toHaveText(/\d+\.\d %/);
	});

	test('arcade theory hint shows in arcade mode and hides in lab mode', async ({ page }) => {
		await page.goto('/game');
		await selectPidMode(page);

		await expect(page.getByTestId('arcade-theory-hint')).toBeVisible();
		await expect(page.getByTestId('lab-mode-hint')).not.toBeVisible();

		await page.getByTestId('actuator-lab').click();
		await expect(page.getByTestId('arcade-theory-hint')).not.toBeVisible();
		await expect(page.getByTestId('lab-mode-hint')).toBeVisible();
	});
});

test.describe('analysis page — closed-loop step response', () => {
	test('renders game-truth and textbook traces and reacts to the actuator toggle', async ({
		page
	}) => {
		await page.goto('/analysis');

		const section = page.getByTestId('closed-loop-section');
		await expect(section).toBeVisible();

		const nonlinear = page.getByTestId('cl-nonlinear-path');
		const linear = page.getByTestId('cl-linear-path');
		await expect(nonlinear).toHaveAttribute('d', /M.+L.+/);
		await expect(linear).toHaveAttribute('d', /M.+L.+/);

		// Switching the actuator changes the nonlinear (game-truth) trace
		const arcadeTrace = await nonlinear.getAttribute('d');
		await page.getByTestId('cl-actuator-lab').click();
		await expect(nonlinear).not.toHaveAttribute('d', arcadeTrace ?? '');
	});
});
