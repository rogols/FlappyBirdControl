# Test Guardrails and Quality Strategy

## 1) Testing Philosophy

This project teaches control behavior; therefore correctness is both **software quality** and **pedagogical quality**.

Test strategy priorities:

1. Deterministic simulation behavior.
2. Mathematical correctness of controller and analysis outputs.
3. Stable UI behavior for classroom demos.
4. Fast feedback in local development and CI.

## 2) Test Pyramid

## 2.1 Unit Tests (majority)

Target modules:

- `game/physics.ts`: gravity, flap impulse, collision bounds.
- `control/*`: on-off state transitions, PID term computation, anti-windup, transfer-function execution.
- `analysis/*`: step response generation, bode data calculation, pole-zero extraction.
- `telemetry/*`: metric aggregation and trace retention windows.

Coverage expectations (initial target):

- Control + analysis modules: >= 90%
- Core simulation modules: >= 85%
- UI utilities/stores: >= 75%

## 2.2 Integration Tests

Examples:

- Controller plugged into simulation loop yields expected behavior over fixed seeds.
- Analysis tuning panel updates the same controller instance consumed by game mode.
- Fast-forward mode preserves deterministic outcomes relative to baseline.

## 2.3 End-to-End Tests (Playwright)

Critical flows:

- Manual mode starts, plays, game over, score persists.
- Switching to auto mode with each controller runs without runtime errors.
- Analysis settings update auto mode behavior.
- High-score list updates and survives reload.

## 2.4 Visual Regression (recommended)

Baseline snapshots for:

- Game HUD + debug overlays
- Analysis charts layout
- Responsive breakpoints used in classroom screens/projectors

## 3) Determinism Guardrail

The simulation engine must provide seedable deterministic behavior:

- Fixed physics step (e.g. 1/120 sec internal stepping).
- Seeded RNG for obstacle generation/disturbances.
- Replay capability from seed + controller settings.

This enables robust regression testing and bug reproduction.

## 4) Numeric Robustness Guardrail

Mandatory runtime checks:

- Assert against NaN/Infinity in plant state and control output.
- Clamp control and state values to physically meaningful bounds.
- Validate transfer-function coefficient input before runtime activation.
- Emit diagnostic events when protective clamps activate.

## 5) Performance Guardrail

Performance budgets (initial):

- 60 FPS in manual mode on target student laptops.
- <= 16 ms average frame time in default view.
- Auto mode at 4x should remain responsive with overlays on.

Automated checks:

- Lightweight performance scenario in CI (headless metric capture).
- Threshold alerting on regressions.

## 6) Accessibility and UX Guardrail

- Keyboard-first operation for manual mode and UI controls.
- Contrast-compliant color choices for charts/overlays.
- Tooltips and labels readable in projector conditions.
- Avoid information overload by grouping debug toggles.

## 7) CI Pipeline Guardrail

Suggested pipeline stages:

1. Install + cache dependencies.
2. Type checks.
3. Lint and formatting checks.
4. Unit/integration tests.
5. E2E smoke tests.
6. Build and artifact validation.

Required merge criteria:

- All checks green.
- No reduced coverage for control/analysis critical modules.
- No unresolved flaky tests.

## 8) Branching and Quality Gates

- Trunk-based or short-lived feature branches.
- PR must include:
  - What changed
  - Why
  - Test evidence
  - Screenshots for visual changes
- At least one reviewer for control-math affecting changes.

## 9) Defect Taxonomy for Fast Triage

- `NUMERIC`: Instability/NaN/divergence
- `CONTROL`: Controller logic mismatch
- `ANALYSIS`: Bode/step/pole-zero inconsistency
- `RENDER`: Visual or Three.js rendering issue
- `UX`: Confusing workflows or accessibility issue
- `PERF`: Frame-time/freeze problems

## 10) Test Data and Scenario Catalog

Maintain a canonical scenario table (in repo) with fixed seeds:

- S1: No disturbance, moderate obstacle spacing.
- S2: Wind disturbance burst at t=20s.
- S3: Narrow obstacle gap stress test.
- S4: High-speed mode (8x) stability run.
- S5: Aggressive PID overshoot demonstration.

Each scenario should define expected pass/fail metrics.
