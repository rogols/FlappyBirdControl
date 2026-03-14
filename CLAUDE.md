# CLAUDE.md — AI Agent Guide for FlappyBirdControl

This file is read automatically by Claude Code and compatible AI agents. Read it fully before making any changes.

## Project Mission

**Flappy Bird Control Lab** is an educational web app that teaches introductory control theory through an interactive, Flappy Bird-inspired game. Students compare manual play against automatic controllers (On-Off, PID, transfer-function), and explore analysis views (ODE, step response, Bode, pole-zero). Correctness is both software quality and pedagogical quality.

---

## Debugging and Problem-Solving Philosophy

> **Read this before touching any bug or unexpected behaviour.**

**Fix the root cause. Never paper over it.**

When something goes wrong, the only acceptable response is to understand the problem at its fundamental level and correct it there. Do not add workarounds, guards, retries, fallbacks, or extra layers of logic to compensate for a flaw you have not diagnosed.

### The required process

1. **Reproduce** the failure deterministically. Use the seeded simulation: identify the seed, step count, and inputs that trigger it every time. A bug you cannot reproduce reliably is a bug you do not yet understand.

2. **Diagnose before touching code.** Read the relevant source, trace the data path, and state — in plain language — exactly why the wrong behaviour occurs. If you cannot state the cause clearly, you do not understand it yet. Keep reading.

3. **Fix at the origin.** The change belongs in the place where the incorrect value is first produced, not downstream where its effects are visible. A symptom fixed at the surface is a bug deferred, not resolved.

4. **Verify the fix is sufficient.** After the change, the root cause must be gone — not merely hidden. Add a test that would have caught the original failure. Confirm `npm run qa` is green.

### What this rules out

| Prohibited response | Why it is wrong |
|---|---|
| Adding a `try/catch` or `|| defaultValue` around a NaN | Hides the source of the NaN; simulation state is now silently corrupt |
| Clamping a value downstream because upstream math is wrong | The upstream math is still wrong; clamping defers the next failure |
| Adding a `setTimeout` / retry to "let things settle" | Treats a race condition or ordering bug as an environmental fluke |
| Increasing a tolerance or epsilon "to make the test pass" | The test was correct; the implementation is wrong |
| Skipping or deleting a failing test | Removes evidence of the defect rather than fixing the defect |
| Adding a special-case `if` for one bad input | Treats a symptom; the general logic is still broken |
| Copying logic into a second place to avoid changing shared code | Creates two sources of truth; both will diverge |

### When you are stuck

If you cannot identify the root cause, **stop and document what you know** rather than attempting a workaround. Write down: what is observed, what was expected, what you have ruled out, and the reproduction seed. Surface this to the team. An undiagnosed bug documented clearly is better than a diagnosed bug patched badly.

---

## Essential Commands

```bash
# Install (run once, also installs Playwright browsers)
npm install
npx playwright install --with-deps chromium

# Development
npm run dev              # Start dev server with hot reload

# Full quality gate (run before every commit)
npm run qa               # check + lint + test:unit (one-shot) + test:e2e

# Individual checks
npm run check            # SvelteKit sync + svelte-check (TypeScript)
npm run lint             # Prettier check + ESLint
npm run format           # Auto-format (run before lint if formatting fails)
npm run test:unit -- --run   # Vitest unit tests (single run, no watch)
npm run test:e2e         # Playwright E2E tests (requires running app)
npm run test             # Full suite: unit + e2e

# Build
npm run build            # Production bundle
npm run preview          # Preview production build locally
```

**Before any commit:** `npm run qa` must pass with zero errors.

---

## Architecture

Seven loosely-coupled modules. Keep them isolated — no hidden cross-module coupling.

```
src/lib/
  game/          # Simulation clock, world state, physics (ODE), obstacles, collision, Three.js renderer
  control/       # Controller interface + On-Off, PID, TransferFunction implementations
  analysis/      # Step response, Bode, pole-zero, ODE model display
  telemetry/     # Time-series recording, overlay rendering, metric aggregation
  persistence/   # LocalStorage: settings, controller presets, high scores, run summaries
  ui/            # Svelte stores, mode configuration

src/routes/
  +page.svelte          # App shell / landing
  game/+page.svelte     # Game view
  analysis/+page.svelte # Analysis & design view
```

### Core Controller Interface (TypeScript contract — do not change without discussion)

```ts
interface Controller {
  reset(initialState?: unknown): void;
  update(input: { t: number; dt: number; setpoint: number; measurement: number }): {
    control: number;
    internals?: Record<string, number>;
  };
}
```

### Physics Model (discrete 2nd-order ODE — must match analysis module exactly)

```
dy/dt = v
m·dv/dt = u − mg − c_d·v|v| + d(t)

Fixed Δt integration (RK4 or semi-implicit Euler)
Seeded RNG for disturbances and obstacles
```

---

## Coding Conventions

- **TypeScript strict mode** everywhere — no `any`, no `@ts-ignore`.
- **Pure functions** for all math (controllers, physics, analysis). No side effects in math code.
- **Controller logic is isolated from rendering** — never mix.
- **Analysis and game runtime share the same model library** — single source of truth.
- **Explicit naming over shorthand** in educational code paths (students read this code).
- Formatting: tabs, single quotes, no trailing commas, 100-char line width (enforced by Prettier).
- File layout follows the directory design in `docs/SOFTWARE_DESIGN_PLAN.md §3.2`.

---

## Testing Requirements by Change Type

| Change type | Required tests |
|---|---|
| Controller logic | Unit tests for state transitions + integration scenario over fixed seed |
| Analysis math | Unit tests with known reference data (compare to analytical results) |
| Physics model | Differential-equation validation: free-fall, drag, bounds |
| UI / gameplay | Playwright E2E scenario + screenshot evidence |
| Performance-sensitive | Before/after frame-time metrics |

**Coverage targets** (enforced — do not reduce):
- `control/` and `analysis/` modules: ≥ 90%
- `game/` core simulation: ≥ 85%
- UI utilities and stores: ≥ 75%

**Numeric robustness** — always assert against `NaN`/`Infinity` in plant state and control output.

**Determinism** — simulation must be reproducible: fixed `Δt`, seeded RNG, replay from seed + controller settings.

---

## Quality Guardrails (Never Violate)

1. `npm run qa` green before any commit.
2. Never reduce test coverage for `control/` or `analysis/` modules.
3. Analysis view and game runtime must use the **same** shared model — never duplicate physics.
4. Control output must be clamped and validated before being applied to the plant.
5. Never merge code that produces `NaN` or `Infinity` in simulation state.
6. Playwright E2E suite must pass on every PR — no exceptions.
7. Preserve deterministic simulation: seeded RNG, fixed `Δt`, no `Date.now()` inside physics loop.

---

## What NOT to Do

**Debugging (see Debugging Philosophy section for full detail):**
- Do not add `try/catch`, default values, or clamps to hide a value you have not diagnosed.
- Do not delete or skip a failing test — it is evidence; fix the code the test exposes.
- Do not widen tolerances or epsilons to make a test pass.
- Do not add a special-case `if` for a bad input when the general logic is wrong.

**Scope:**
- Do not refactor code not directly related to your task.
- Do not add comments or docstrings to unchanged code.
- Do not make speculative improvements not tied to a documented requirement.

**Architecture:**
- Do not introduce coupling between `game/` and `analysis/` modules.
- Do not use `Date.now()` or `Math.random()` inside physics or simulation code (use seeded RNG).
- Do not bypass ESLint with `eslint-disable` without a documented reason.
- Do not skip Playwright tests — they are mandatory, not optional.

---

## Commit and PR Standards

**Commit message format:**
```
<type>(<scope>): <short imperative summary>

<optional body: what and why, not how>
```

Types: `feat`, `fix`, `test`, `refactor`, `docs`, `perf`, `chore`
Scopes: `game`, `control`, `analysis`, `telemetry`, `persistence`, `ui`, `ci`, `deps`

Examples:
- `feat(control): add PID anti-windup back-calculation`
- `fix(physics): clamp velocity to prevent NaN at high drag`
- `test(analysis): add bode-plot reference data assertions`

**PR checklist:**
- Summary and rationale
- Test commands run + output (must show `npm run qa` passing)
- Screenshots or video for any visual change
- Note: human-authored / AI-assisted / AI-authored
- Risks and rollback considerations
- Follow-up tasks if deferred

---

## Key Documentation

Read these before implementing anything non-trivial:

| File | When to read |
|---|---|
| `docs/SOFTWARE_DESIGN_PLAN.md` | Before adding any new module, route, or data model |
| `docs/TEST_GUARDRAILS.md` | Before writing or modifying tests |
| `docs/DEVELOPMENT_WORKFLOW.md` | Before branching or creating a PR |
| `docs/ONBOARDING.md` | For local setup and contribution norms |

---

## Defect Taxonomy (use in issue/PR labels)

| Tag | Meaning |
|---|---|
| `NUMERIC` | NaN / Infinity / divergence in simulation |
| `CONTROL` | Controller logic mismatch or wrong behavior |
| `ANALYSIS` | Bode / step / pole-zero inconsistency with runtime |
| `RENDER` | Three.js or visual rendering issue |
| `UX` | Confusing workflows or accessibility regression |
| `PERF` | Frame-time or freeze problem |

---

## Agent Self-Check Before Committing

Run through this list mentally before `git commit`:

- [ ] `npm run qa` passes with zero errors
- [ ] Every bug fixed at its root cause — no workarounds, no suppressed symptoms
- [ ] No test was deleted, skipped, or had its tolerance widened to achieve green
- [ ] New/changed math is unit-tested with reference data
- [ ] No `NaN`/`Infinity` possible in simulation output
- [ ] No new coupling introduced between isolated modules
- [ ] Analysis and game runtime still share the same physics model
- [ ] Commit message follows `<type>(<scope>): <summary>` format
- [ ] PR description includes test evidence and change rationale
