# Flappy Bird Control Lab — Software Design Plan

## 1) Purpose and Learning Outcomes

This project transforms Flappy Bird into a **control-theory teaching laboratory** for first-course BSc students.

Primary pedagogical outcomes:

- Experience closed-loop control in an intuitive, game-like environment.
- Compare controller families under identical process disturbances and constraints:
  - Manual play (human-in-the-loop)
  - On-off control
  - PID control
  - Generic transfer-function controller \(C(s)\)
- Connect analysis artifacts (ODE, step response, Bode, pole-zero maps) to behavior in simulation.
- Build intuition through debug overlays and fast-forward simulation.

## 2) Product Scope

### In Scope (MVP → v1)

- A playable Flappy Bird-like game implemented in Three.js (initially 2D camera/projection style).
- Game modes:
  - Manual control
  - Automatic control with On-Off, PID, and Generic \(G(s)\)-based controller
- One dedicated **Control Analysis & Design** view tied to the live game model.
- Real-time debug overlays for automatic mode (setpoint, error, control signal, predicted trajectory).
- Scores, high-score list, auto-mode speed controls (1x/2x/4x/8x+), run replay metadata.
- Robust testing and CI guardrails.

### Explicit Future Scope

- Visual progression in game art:
  1. Primitive 3D geometry (boxes/spheres/cylinders)
  2. Textured assets inspired by Flappy Bird
  3. Extended low-poly visual identity

### Non-Goals (initial)

- Multiplayer
- Cloud-hosted leaderboards with accounts
- Mobile-native app packaging

## 3) System Architecture Overview

Use a modular front-end architecture in SvelteKit + TypeScript.

## 3.1 High-Level Modules

1. **Game Engine Module**
   - Simulation clock, world state, physics integration, obstacle generation, collision logic.
   - Renderer adapter (Three.js scene + camera + UI hooks).

2. **Control Core Module**
   - Controller interface + implementations (On-Off, PID, TransferFunctionController).
   - Discrete-time execution, saturation, anti-windup, signal filtering.

3. **Plant/Process Model Module**
   - Bird vertical dynamics + control input mapping.
   - Disturbance injection (wind, noise, lag) for teaching experiments.

4. **Analysis Module**
   - ODE representation and symbolic/textual model display.
   - Step response generation.
   - Frequency-domain analysis (Bode) from discrete/continuous representations.
   - Pole-zero analysis for process and closed-loop model.

5. **Telemetry & Debug Module**
   - Time-series recording (error, control effort, altitude, velocity, collisions).
   - Overlay rendering primitives and trace history.

6. **Persistence Module**
   - Local storage for user settings, controller presets, high scores, recent run summaries.

7. **UI Module**
   - Game tab
   - Analysis/Design tab
   - Debug panel and run controls

## 3.2 Suggested Directory Design

```txt
src
  /lib
    /game
      engine.ts
      state.ts
      physics.ts
      obstacles.ts
      collision.ts
      scene-three.ts
    /control
      interfaces.ts
      onoff-controller.ts
      pid-controller.ts
      tf-controller.ts
      discretization.ts
      signal-utils.ts
    /analysis
      model.ts
      step-response.ts
      bode.ts
      pole-zero.ts
    /telemetry
      recorder.ts
      overlays.ts
      metrics.ts
    /persistence
      highscore-store.ts
      preset-store.ts
      run-store.ts
    /ui
      stores.ts
      mode-config.ts
  /routes
    +page.svelte                  # app shell / landing
    /game/+page.svelte
    /analysis/+page.svelte
```

## 4) Core Domain Model

### 4.1 Process Variables

- Controlled variable \(y\): bird height (or normalized vertical position).
- Setpoint \(r\): desired height trajectory (constant/step/pattern).
- Error \(e = r - y\).
- Control output \(u\): flap impulse or thrust equivalent.

### 4.2 Discrete-Time Update Contract

Every simulation tick \(k\):

1. Read process output \(y_k\).
2. Compute error \(e_k\).
3. Controller computes \(u_k\).
4. Apply actuator limits and optional deadband.
5. Integrate plant physics \(x\_{k+1} = f(x_k, u_k, d_k)\).
6. Update telemetry and overlays.

### 4.3 Controller Interface

```ts
interface Controller {
	reset(initialState?: unknown): void;
	update(input: { t: number; dt: number; setpoint: number; measurement: number }): {
		control: number;
		internals?: Record<string, number>;
	};
}
```

### 4.4 Physics Model (Realistic Differential Equation Baseline)

The bird should be modeled as a physically meaningful second-order vertical process:

- State: vertical position \(y\) and velocity \(v\).
- Dynamics:
  - \(\dot y = v\)
  - \(m\dot v = u - mg - c_d v\lvert v \rvert + d(t)\)

Where:

- \(m\): bird mass
- \(g\): gravitational acceleration
- \(c_d\): aerodynamic drag coefficient
- \(u\): control input force from flap/thrust actuator
- \(d(t)\): disturbance term (wind gusts / turbulence)

Discrete-time runtime integration (fixed step \(\Delta t\)) should be implemented consistently for both analysis and game simulation, with optional RK4 or semi-implicit Euler integration depending on performance targets.

Minimum model constraints:

- Enforce actuator saturation between `u_min` and `u_max`.
- Enforce velocity and altitude bounds to avoid non-physical states.
- Keep deterministic results under fixed seed + fixed \(\Delta t\).

## 5) Controller Designs

## 5.1 On-Off Controller

- Parameters: threshold/deadband, high output, low output.
- Optional hysteresis to avoid chattering.
- Good for introducing limit cycles and basic logic control.

## 5.2 PID Controller

- Parameters: \(K_p, K_i, K_d\), derivative filter coefficient, output limits.
- Features: anti-windup (back-calculation or clamping), bumpless transfer between manual/auto.
- Visualize P/I/D terms independently in overlays.

## 5.3 Generic Transfer Function Controller \(C(s)\)

- Input forms:
  - Numerator/denominator polynomial coefficients
  - Optional zero-pole-gain form
- Include discretization choices (Tustin, ZOH approximation).
- Show resulting \(C(z)\) and update difference equation used in runtime.

## 6) Analysis & Design View Requirements

The analysis view must bind directly to the same model/controller used by game runtime.

Must include:

- Process differential equation in readable form (same coefficients as game runtime model).
- Step response plot (configurable step amplitude and horizon).
- Bode magnitude/phase plot (open-loop and optional closed-loop).
- Pole-zero map with stability cues.
- Controller tuning panel:
  - On-Off parameters
  - PID gains and options
  - Generic \(C(s)\) coefficients + discretization
- “Apply to Auto Mode” action that updates active game controller.

## 7) Debug Visualization Requirements

Overlay toggles in automatic mode:

- Current setpoint line and actual altitude trace.
- Error bar/value + recent error history.
- Control effort meter and saturation indicators.
- Predicted short-horizon trajectory.
- Collision envelope and obstacle gap projection.
- Optional vectors (velocity, acceleration).
- Controller internals:
  - On-Off state + hysteresis state
  - PID P/I/D contributions
  - Transfer function internal state values

## 8) UX and Interaction Design Principles

- Prioritize clarity, legibility, low cognitive overhead for classroom use.
- Side-by-side “Game vs Analysis” mental model:
  - Analysis tab edits parameters.
  - Game tab instantly reflects controller behavior.
- Preset system:
  - “Stable beginner PID”, “Aggressive PID”, “Oscillatory On-Off”, etc.
- Fast-forward in auto mode with deterministic simulation stepping.
- Strong empty states/tooltips explaining control-theory concepts.

## 9) Data Persistence Design

Local persistence keys:

- `fbc.settings`
- `fbc.highscores`
- `fbc.controller-presets`
- `fbc.recent-runs`

High score record proposal:

```ts
interface HighScore {
	id: string;
	mode: 'manual' | 'auto-onoff' | 'auto-pid' | 'auto-tf';
	score: number;
	durationSec: number;
	speedMultiplier: number;
	timestamp: string;
	controllerSnapshot: Record<string, unknown>;
}
```

## 10) Implementation Roadmap

## Phase 0 — Foundation (1 sprint) ✅ COMPLETED 2026-03-14

- Architecture scaffolding, type contracts, base stores.
- Deterministic simulation loop.
- Realistic baseline physics model using the defined ODE and fixed-step integration.
- Primitive-scene Three.js rendering and manual mode.

**Delivered:**

- `src/lib/control/interfaces.ts` — Controller interface (shared contract)
- `src/lib/game/physics.ts` — 2nd-order ODE, semi-implicit Euler, actuator saturation, bounds clamping
- `src/lib/game/state.ts` — mulberry32 seeded RNG, WorldState, createInitialState
- `src/lib/game/obstacles.ts` — Obstacle type, deterministic spawn/update
- `src/lib/game/collision.ts` — Bird-obstacle and bounds collision detection
- `src/lib/game/engine.ts` — GameEngine with fixed-dt sub-stepping
- `src/lib/game/scene-three.ts` — Orthographic Three.js scene (primitive geometry)
- `src/lib/control/onoff-controller.ts` — On-Off controller with hysteresis
- `src/lib/control/pid-controller.ts` — PID with derivative filter and anti-windup
- `src/lib/control/signal-utils.ts` — Pure signal utility functions
- `src/lib/ui/stores.ts` — Svelte writable stores (gameMode, activeController, gameRunning)
- `src/lib/ui/mode-config.ts` — Mode metadata
- `src/lib/analysis/model.ts` — Stub (Phase 2 target)
- `src/lib/telemetry/recorder.ts` — Ring-buffer stub (Phase 1 target)
- `src/lib/persistence/highscore-store.ts` — LocalStorage-backed high scores
- `src/routes/+page.svelte` — Landing page with mode list and nav
- `src/routes/game/+page.svelte` — Game page: canvas, RAF loop, keyboard handler, mode selector
- `src/routes/analysis/+page.svelte` — Placeholder (Phase 2 target)
- Unit tests: 43 passing (physics ×16, On-Off ×13, PID ×13, demo ×1)

## Phase 1 — Core Auto Modes (1–2 sprints) ✅ COMPLETED 2026-03-14

- On-Off + PID in game loop.
- Telemetry and baseline overlays.
- Score/high-score implementation.

**Delivered:**

- `src/lib/telemetry/recorder.ts` — TelemetryRecorder ring buffer (record, getHistory, getLatest, clear); wired into game RAF loop
- `src/lib/persistence/highscore-store.ts` — save/retrieve/clear, top-10 per mode sorted by score; saved on game-over
- `src/lib/game/scene-three.ts` — OverlayData interface; setpoint line + effort bar meshes shown in auto mode only
- `src/routes/game/+page.svelte` — auto controller loop (On-Off, PID) calling controller.update() each tick; game-over overlay with score + restart; top-3 high scores display
- Unit tests: 75 passing (telemetry ×19, persistence ×13, + Phase 0 suite)

## Phase 2 — Analysis View (1–2 sprints) ✅ COMPLETED 2026-03-14

- ODE display and step response.
- Bode + pole-zero visualizations.
- Parameter binding and “apply to game”.

**Delivered:**

- `src/lib/analysis/step-response.ts` — open-loop step response using shared `stepPhysics`
- `src/lib/analysis/bode.ts` — Bode plots for plant P(s)=1/(m·s²), PID C(s), open-loop L, closed-loop T
- `src/lib/analysis/pole-zero.ts` — pole-zero maps; Durand–Kerner root finding for closed-loop cubic
- `src/lib/analysis/model.ts` — ODE display helpers, equilibrium, plant TF coefficients
- `src/routes/analysis/+page.svelte` — step response SVG chart, Bode magnitude/phase charts, pole-zero SVG map, On-Off + PID tuning panels, “Apply to Auto Mode” buttons
- Unit tests: 51 new (step-response ×11, bode ×23, pole-zero ×17)

## Phase 3 — Generic \(G(s)\) Controller (1 sprint) ✅ COMPLETED 2026-03-14

- Transfer function input + discretization.
- Runtime difference equation execution.
- Controller validation checks and stability warnings.

**Delivered:**

- `src/lib/control/discretization.ts` — polynomial arithmetic helpers (`polyMul`, `polyAdd`, `polyScale`, `polyPow`) and Tustin bilinear transform `tustinDiscretize`; `formatPolyZ` for display
- `src/lib/control/tf-controller.ts` — `TFController` class implementing the `Controller` interface via Direct Form I difference equation; `DEFAULT_TF_PARAMS` (filtered PD: (2s+8)/(0.05s+1))
- `src/routes/analysis/+page.svelte` — G(s) tuning panel: coefficient text inputs, live Tustin discretization display, discrete pole locations with stability indicator (|z| < 1), “Apply to Auto Mode (Transfer Function)” button
- `src/routes/game/+page.svelte` — `auto-tf` mode wired to `TFController`; falls back to default params if no analysis-view controller set
- Unit tests: 38 new (discretization ×21, tf-controller ×17)

## Phase 4 — Visual Evolution + Learning Polish (ongoing)

- Texture pass then low-poly pass.
- Extended overlays, classroom presets, guided scenarios.

## 11) Risks and Mitigations

- **Numerical instability at high fast-forward factors**
  - Mitigation: fixed-step simulation + sub-stepping.
- **Controller misuse causing NaN or explosive outputs**
  - Mitigation: parameter validation, saturation, guard assertions.
- **Student confusion from too many options**
  - Mitigation: progressive disclosure and presets.
- **Drift between analysis model and runtime model**
  - Mitigation: single shared model library + contract tests.

## 12) Definition of Done (v1)

- All 4 modes playable (manual + 3 controller types).
- Analysis view outputs consistent with runtime behavior.
- Debug overlays toggleable and performant.
- Scores and high-score list operational.
- CI green with test guardrails and minimum quality thresholds.
