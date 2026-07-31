# Onboarding Guide (Humans + AI Agents)

## 1) Project Mission

Flappy Bird Control Lab is a teaching-oriented web app where control theory concepts become interactive through gameplay and controller design experimentation.

Read first:

1. `docs/improvement-plan.md` — **plan of record**; pick your next work item here
2. `docs/SOFTWARE_DESIGN_PLAN.md` — design reference (its roadmap is fully delivered)
3. `docs/TEST_GUARDRAILS.md`
4. `docs/DEVELOPMENT_WORKFLOW.md`

### Domain concepts you need before touching the loop

- **Plant.** The bird's vertical dynamics: `m·v̇ = u − m·g − c_d·v|v| + d(t)`, integrated
  at a fixed Δt = 1/60 s in `src/lib/game/physics.ts`. This file is the single source of
  truth shared by the game runtime and the analysis views — never duplicate it.
- **Actuator modes** (`src/lib/game/actuator.ts`) decide what a controller's output
  _means_ before it reaches the plant:
  - `arcade` — the output is total thrust, clamped to `[0, 40] N`. One-sided: the
    controller pushes up, only gravity pulls down. Authentic game feel, but the loop does
    not match the linear analysis model (a PD controller droops by `m·g/Kp` at steady
    state, because the controller itself must produce the hover force).
  - `lab` — the output is a _deviation_ `u′` about the exact hover equilibrium, so the
    plant receives `u = m·g + u′` with `u′ ∈ ±m·g`. The loop is then precisely the double
    integrator `P(s) = 1/(m·s²)` that the Bode and pole-zero views analyse, and textbook
    overshoot/oscillation become visible. Lab runs spawn no obstacles.

  Both modes derive the controller clamp _and_ the plant saturation from the same
  numbers, so they can never disagree. Add new actuator behaviour here, not in the pages.

- **Setpoint schedule** (`src/lib/game/setpoint-schedule.ts`) is a pure function of
  simulation time, so a run is fully reproducible from seed + schedule + controller.
- **Theory bridge.** `src/lib/analysis/closed-loop.ts` simulates the loop twice — once
  through the real game path, once through the linearised model — so the difference
  between what theory predicts and what the game shows is explicit rather than confusing.
  A contract test pins the first simulation to `GameEngine` step-for-step; keep it green,
  it is what stops the analysis views from drifting away from the runtime.

## 2) Local Setup

Prerequisites:

- Node.js LTS
- npm

Setup:

```bash
npm install
npx playwright install --with-deps chromium
npm run dev
```

Quality checks:

```bash
npm run check
npm run lint
npm run test:unit -- --run
npm run test:e2e
npm run test
```

## 3) Onboarding Tracks

### 3.1 Human Contributors

Recommended first tasks:

- Improve one small debug overlay.
- Add one deterministic controller unit test.
- Improve one analysis-view label or tooltip.

### 3.2 AI-Agent Contributors

AI-agent contributions should follow the same quality bar as human work:

- Read all planning docs before making implementation changes.
- Keep commits small and scoped to one coherent objective.
- Run required checks (`check`, `lint`, and Playwright-inclusive tests).
- Provide explicit test evidence and changed-file rationale in PRs.
- Avoid speculative refactors not tied to a documented requirement.

## 4) Coding and Design Expectations

- Use clear TypeScript interfaces and pure functions for math-heavy code.
- Keep controller logic isolated from rendering code.
- Avoid hidden coupling between analysis and game modules.
- Favor explicit naming over shorthand in educational code paths.

## 5) Testing Expectations by Change Type

- Controller logic change: unit + integration scenario required.
- Analysis math change: unit tests with known reference data.
- Physics model change: include differential-equation validation tests.
- UI/gameplay change: Playwright e2e scenario + screenshot evidence.
- Performance-sensitive change: include before/after metrics.

## 6) Team Communication Norms

- Document assumptions in PR descriptions.
- Flag pedagogical impacts explicitly.
- Prefer reproducible examples using fixed seeds.

## 7) Where to Ask Questions

When uncertain, ask in issue/PR comments with:

- expected behavior
- observed behavior
- reproduction steps
- seed and controller parameters
