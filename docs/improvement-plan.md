# Improvement Plan — Flappy Bird Control Lab

> **Plan of record.** This document supersedes the roadmap in
> `docs/SOFTWARE_DESIGN_PLAN.md` (Phases 0–6 there are all delivered; that file remains
> the authoritative _design_ reference). Agents: read
> [Part 2 — How to use this document](#how-to-use-this-document) before picking up work.

**Audit date:** 2026-07-03 · **Audited commit:** `a49e858` · **Owner:** Roger Olsson

---

## Part 1 — Executive Summary

### Audit verdict

**Strengths.** The core of this project is in genuinely good shape. The simulation is
deterministic by construction (seeded mulberry32 RNG, fixed-Δt sub-stepping, no wall-clock
reads inside the physics loop), the math lives in pure, well-tested modules, and the game
and analysis views share a single physics model as the design mandates. TypeScript strict
mode is clean (0 errors across 807 files), lint is clean, and all 232 unit tests pass. The
build succeeds in under 4 seconds. All seven phases of the original roadmap are delivered:
manual play, three controller families (On-Off, PID, transfer-function with Tustin
discretization), the full analysis view (step response, Bode, pole-zero), telemetry
metrics (ISE/IAE/ITAE, settling time), presets, disturbance injection, run history, and a
sprite-based texture pass. The agent-facing documentation (AGENTS.md, `.claude/` skills
and roles) is unusually thorough.

**Blockers.** The safety net the documentation promises does not exist. There is **no CI
at all** — no `.github/` directory — despite AGENTS.md declaring "Playwright E2E suite
must pass on every PR." Coverage targets (≥ 90% for `control/` and `analysis/`) are
labelled "enforced," but no coverage tooling is installed, so nothing enforces them. The
E2E suite is a single placeholder test (asserts an `<h1>` is visible); none of the four
critical flows named in `docs/TEST_GUARDRAILS.md` are covered, and the S1–S5 scenario
catalog was never built. The two route pages are the weakest code in the repo:
`src/routes/analysis/+page.svelte` (892 lines) and `src/routes/game/+page.svelte`
(728 lines) contain the RAF game loop, controller orchestration, and chart construction
inline, where unit tests cannot reach them. Documentation had drifted: a stale `Agents.md`
contradicted `AGENTS.md` about which file was canonical (fixed in the same commit that
adds this plan). Finally, `static/sprites/` contains the original copyrighted Flappy Bird
art (.GEARS Studio) — acceptable for private classroom use, a legal risk if the repo or a
deployment is public — and there is no deployment story (`adapter-auto` with no target).

### Product direction

Decisions below were **confirmed by the owner on 2026-07-04** (except where noted).
One residual tension from those answers is logged as OQ-5 in Part 2.

| Topic           | Direction (decided)                                                                            | Status               | Ref  |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------- | ---- |
| Audience        | BSc students in an introductory control course; instructor-driven classroom use                | Inferred from docs   | —    |
| Business model  | Free educational tool; no monetization                                                         | Inferred from docs   | —    |
| Stack           | Keep SvelteKit + TypeScript + Three.js; no migration                                           | Confirmed by audit   | —    |
| Deployment      | Static build (`adapter-static`) deployed to GitHub Pages via CI                                | Confirmed 2026-07-04 | OQ-1 |
| Data strategy   | localStorage only — no backend, no file export (run-export item dropped)                       | Confirmed 2026-07-04 | OQ-2 |
| Next capability | Pedagogy & curriculum → analysis depth → UX & accessibility; replay tooling deferred           | Confirmed 2026-07-04 | OQ-3 |
| Game art        | Keep the .GEARS sprites; private classroom use accepted — but see OQ-5 re public Pages hosting | Confirmed 2026-07-04 | OQ-4 |

### Recommended stack additions

| Addition                               | Why (one line)                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GitHub Actions workflow                | The only missing piece between "quality gate documented" and "quality gate enforced."                |
| `@vitest/coverage-v8` + thresholds     | AGENTS.md already mandates coverage floors; this makes them real.                                    |
| `engines` field + `.nvmrc`             | Pins Node/npm so agents, CI, and humans run the same toolchain.                                      |
| `@sveltejs/adapter-static`             | The app is fully client-side; static output enables zero-cost GitHub Pages hosting (OQ-1 confirmed). |
| _Deliberately omitted:_ error tracking | Client-side classroom app with no backend; CI + E2E is the right-sized safety net.                   |

### The plan in one paragraph

Phase 0 stabilizes: add CI that runs the existing quality gate on every PR, pin the
toolchain, install coverage enforcement, delete scaffold leftovers, and replace the
placeholder E2E test with the four documented critical flows — so the safety net exists
before anything moves. Phase 1 pays down the main architectural debt behind that net:
extract the game-session orchestration and analysis chart builders out of the two
oversized route pages into testable library modules, then encode the S1–S5 scenario
catalog as seeded integration tests. Phases 2–4 then add capability in the order the
owner confirmed — pedagogy (guided scenarios, concept explanations), analysis depth
(stability margins, closed-loop step response, root locus), and UX & accessibility
(keyboard/contrast, projector-friendly classroom display). Replay/comparison tooling is
deferred, run export is dropped (localStorage-only decision), deployment targets GitHub
Pages, and the copyrighted sprites stay under an accepted private-use constraint — with
one caveat (OQ-5): a Pages deployment serves those sprites publicly, which the owner
still needs to reconcile before FBC-007 ships.

---

## Part 2 — Agent-Ready Backlog

### How to use this document

1. **Pick the lowest-numbered item with `Status: Todo` whose `Depends-on` items are all
   `Done`.** Items marked `Blocked` wait on an open question (OQ-x) — skip them and do
   not start them until the owner has answered.
2. **Work the item within its stated Scope.** Do not bundle neighbouring items into one
   change; one item = one PR-sized change.
3. **Pass the verification gate before marking anything done.** Every item's gate includes
   `npm run qa` (check + lint + unit + e2e) green, plus any item-specific criteria listed
   under Acceptance. Never weaken a test to get green (see AGENTS.md).
4. **Update this file in the same commit** that completes the item: set `Status: Done`,
   and add a one-line completion note (date + commit subject) under the item.
5. **If you discover new work,** add a new item with the next free ID in the matching
   phase — never renumber or reuse IDs.

Status values: `Todo` · `In progress` · `Blocked` · `Done` · `Deferred` (owner
deprioritized; do not pick up) · `Dropped` (owner decided against; kept for the record).
Priority values: `P0` (do first) · `P1` (next) · `P2` (nice to have).

---

### Phase 0 — Stabilize (safety net before features)

#### FBC-001 — Add CI pipeline (GitHub Actions)

- **Status:** Todo · **Priority:** P0 · **Depends-on:** —
- **Problem:** No CI exists (`.github/` is absent), so the documented rule "Playwright
  E2E must pass on every PR" is unenforced; regressions land silently.
- **Scope:** Add `.github/workflows/ci.yml` running on PRs and pushes to `main`:
  install deps (with npm cache), `npx playwright install --with-deps chromium`, then
  `npm run check`, `npm run lint`, `npm run test:unit -- --run`, `npm run test:e2e`,
  `npm run build`. Upload the Playwright report as an artifact on failure.
- **Acceptance:** Workflow is green on a PR from a clean checkout; a deliberately
  broken test on a scratch branch turns it red. Gate: `npm run qa` locally + CI green.

#### FBC-002 — Pin the toolchain

- **Status:** Todo · **Priority:** P0 · **Depends-on:** —
- **Problem:** No Node version is pinned anywhere; agents, CI, and humans can drift.
  (The audit itself hit a Playwright-browser/version mismatch in a fresh environment.)
- **Scope:** Add `engines` to `package.json` (Node LTS), add `.nvmrc`, and note the
  pinned versions in AGENTS.md's setup section. Do not change any script.
- **Acceptance:** `npm install` warns/fails on wrong Node major (engine-strict
  documented); CI (FBC-001, if present) uses the pinned version. Gate: `npm run qa`.

#### FBC-003 — Enforce coverage thresholds

- **Status:** Todo · **Priority:** P0 · **Depends-on:** FBC-001
- **Problem:** AGENTS.md calls coverage targets "enforced" (≥ 90% control/analysis,
  ≥ 85% game core, ≥ 75% UI utilities) but no coverage tooling is installed.
- **Scope:** Add `@vitest/coverage-v8`; configure per-directory thresholds in
  `vite.config.ts` at or slightly below current actuals (measure first — never set a
  threshold above reality to force a scramble); add `npm run test:coverage`; run it in CI.
- **Acceptance:** `npm run test:coverage` reports per-module coverage and fails when a
  threshold is violated; CI runs it. Gate: `npm run qa` + coverage job green.

#### FBC-004 — Remove scaffold leftovers

- **Status:** Todo · **Priority:** P1 · **Depends-on:** —
- **Problem:** `src/demo.spec.ts` (asserts 1 + 2 = 3) and the placeholder naming of
  `e2e/demo.test.ts` are template residue that pads the test count and misleads agents.
- **Scope:** Delete `src/demo.spec.ts`; rename `e2e/demo.test.ts` to `e2e/smoke.test.ts`
  (keep the h1 assertion as a genuine smoke test). Touch nothing else.
- **Acceptance:** Test count drops by exactly one; suite green. Gate: `npm run qa`.

#### FBC-005 — Implement the four documented critical E2E flows

- **Status:** Todo · **Priority:** P0 · **Depends-on:** FBC-004
- **Problem:** `docs/TEST_GUARDRAILS.md §2.3` names four mandatory Playwright flows;
  none exist. Without them, the Phase 1 refactor of the route pages is unprotected.
- **Scope:** Add E2E specs for: (1) manual mode — start, play, game over, score
  persists; (2) each auto mode (On-Off, PID, TF) runs without console errors; (3) an
  analysis-view parameter change applies to auto mode; (4) high-score list survives
  reload. Use deterministic seeds; assert no `NaN` appears in visible telemetry.
- **Acceptance:** All four flows pass headless in CI; flake-free across 3 consecutive
  runs. Gate: `npm run qa`.

#### FBC-006 — Document the game-art licensing constraint

- **Status:** Todo · **Priority:** P1 · **Depends-on:** —
- **Owner decision (2026-07-04, OQ-4):** keep the .GEARS sprites; private classroom use
  accepted.
- **Problem:** `static/sprites/` contains the original copyrighted Flappy Bird sprites
  (.GEARS Studio, via samuelcust/flappy-bird-assets). The accepted risk must be written
  down so no agent or contributor publishes them unknowingly.
- **Scope:** Record the constraint in README and AGENTS.md: sprites are copyrighted,
  private/educational use only, repo must not be made public and no public deployment
  may serve them until OQ-5 is resolved; note that `scene-three.ts` retains a
  licensing-clean primitive-geometry fallback.
- **Acceptance:** Constraint documented in README + AGENTS.md with asset provenance.
  Gate: `npm run qa`.

#### FBC-007 — GitHub Pages deployment via adapter-static

- **Status:** Blocked (OQ-5) · **Priority:** P1 · **Depends-on:** FBC-001, FBC-006, OQ-5
- **Owner decision (2026-07-04, OQ-1):** deploy to GitHub Pages.
- **Problem:** `adapter-auto` has no detected target; there is no way for students to
  reach the app without running a dev server.
- **Scope:** Switch to `@sveltejs/adapter-static` (+ `paths.base` for project pages),
  add a Pages deploy job to CI, verify both routes and sprite loading under the base path.
- **Caution (OQ-5):** a GitHub Pages site is publicly reachable, so it would serve the
  copyrighted sprites publicly — beyond the private-use risk accepted in OQ-4. Do not
  ship this item until the owner resolves OQ-5 (accept public exposure, swap assets, or
  restrict hosting).
- **Acceptance:** URL serves the app; game and analysis routes work; deploy runs on push
  to `main`; OQ-5 resolution recorded here. Gate: `npm run qa` + manual smoke of the
  deployed URL.

---

### Phase 1 — Refactor for testability (debt paydown behind the net)

#### FBC-101 — Extract game-session orchestration from the game route

- **Status:** Todo · **Priority:** P1 · **Depends-on:** FBC-005
- **Problem:** `src/routes/game/+page.svelte` (728 lines) holds the RAF loop, controller
  selection/stepping, telemetry wiring, scoring, and run persistence inline — the most
  behaviour-rich code in the repo with zero unit coverage.
- **Scope:** Create `src/lib/game/session.ts` (framework-free class/functions) owning:
  controller-for-mode construction, per-tick controller update + engine stepping,
  telemetry recording, game-over bookkeeping (high score + run summary). The Svelte page
  keeps only rendering, input handling, and store subscriptions. No behaviour change.
- **Acceptance:** Page shrinks below ~300 lines; new module has unit tests covering
  mode switching, a seeded auto-mode run, and game-over persistence; E2E flows
  (FBC-005) still green. Gate: `npm run qa` + coverage not reduced.

#### FBC-102 — Extract analysis chart building from the analysis route

- **Status:** Todo · **Priority:** P1 · **Depends-on:** FBC-005
- **Problem:** `src/routes/analysis/+page.svelte` (892 lines) builds SVG chart geometry
  (step response, Bode, pole-zero) inline; chart math is untestable and duplicated
  scaling logic is likely.
- **Scope:** Move point/path/scale computation into pure functions (e.g.
  `src/lib/analysis/chart-data.ts` or `src/lib/ui/charts.ts`); the page maps their
  output to SVG markup. No visual change.
- **Acceptance:** Chart builders unit-tested against known reference data; page under
  ~450 lines; screenshots before/after match. Gate: `npm run qa` + coverage not reduced.

#### FBC-103 — Scenario catalog S1–S5 as seeded integration tests

- **Status:** Todo · **Priority:** P1 · **Depends-on:** FBC-101
- **Problem:** `docs/TEST_GUARDRAILS.md §11` mandates a canonical seeded scenario table
  (S1 baseline, S2 wind burst, S3 narrow gaps, S4 8× speed, S5 aggressive-PID
  overshoot); it was never built.
- **Scope:** Add a fixture module defining the five scenarios (seed, physics/obstacle
  config, controller, disturbance schedule, expected metric bounds) and an integration
  test that runs each headless through `GameEngine` + `session.ts` and asserts the
  metric envelopes and no-NaN invariants.
- **Acceptance:** Five scenarios run deterministically (same metrics across runs);
  documented in TEST_GUARDRAILS. Gate: `npm run qa`.

#### FBC-104 — Engine cleanup: remove dead `nextObstacleX` bookkeeping

- **Status:** Todo · **Priority:** P2 · **Depends-on:** —
- **Problem:** `GameEngine.nextObstacleX` (src/lib/game/engine.ts:63) is written but
  never read; spawn logic actually derives from `rightmostX`. Dead state misleads agents.
- **Scope:** Remove the field and its writes; no behavioural change.
- **Acceptance:** Unit tests unchanged and green. Gate: `npm run qa`.

---

### Phase 2 — Pedagogy & curriculum (recommended next capability)

#### FBC-201 — Guided scenario mode

- **Status:** Todo · **Priority:** P1 · **Depends-on:** FBC-103
- **Problem:** Students face all options at once; the docs call for progressive
  disclosure and guided experiments, and nothing implements it.
- **Scope:** A "Scenarios" panel on the game page that loads an S1–S5 scenario (from the
  FBC-103 fixtures), states the learning goal, runs it, and shows the resulting metrics
  against the expected envelope.
- **Acceptance:** Each scenario playable end-to-end from the UI; E2E test for one
  scenario flow. Gate: `npm run qa`.

#### FBC-202 — Concept explanations and tooltips

- **Status:** Todo · **Priority:** P2 · **Depends-on:** FBC-005
- **Problem:** Analysis views assume vocabulary (Bode, pole-zero, settling time) that a
  first-course student may not have; docs require "strong empty states/tooltips."
- **Scope:** Short, accurate explanations attached to each analysis chart and metric
  (tooltip or collapsible note). Educational text is a correctness surface — the math
  role should review wording.
- **Acceptance:** Every chart and metric has an explanation; a11y: tooltips reachable by
  keyboard. Gate: `npm run qa`.

#### FBC-203 — Export run data for lab reports

- **Status:** Dropped · **Priority:** — · **Depends-on:** —
- **Owner decision (2026-07-04, OQ-2):** data strategy is localStorage only — no backend
  and no file export. Kept for the record; do not implement unless the owner reverses
  the decision here.

---

### Phase 3 — Analysis depth

#### FBC-301 — Gain and phase margins on the Bode view

- **Status:** Todo · **Priority:** P1 · **Depends-on:** FBC-102
- **Problem:** The Bode plot shows magnitude/phase but not the stability margins that
  make it pedagogically actionable.
- **Scope:** Compute gain margin, phase margin, and crossover frequencies from the
  open-loop response in `src/lib/analysis/bode.ts`; display markers + values on the
  charts. Math role reviews; unit tests against analytical reference systems.
- **Acceptance:** Margins match analytical values for at least two reference systems to
  4 significant figures. Gate: `npm run qa` + coverage floor for `analysis/`.

#### FBC-302 — Closed-loop step response for all controller types

- **Status:** Todo · **Priority:** P1 · **Depends-on:** FBC-102
- **Problem:** The step-response view is open-loop only; students cannot see the effect
  of their tuned controller on the tracking response — the single most instructive plot.
- **Scope:** Simulate the closed loop (shared physics + active controller) for a
  configurable step; plot alongside the open-loop response; verify consistency with the
  game runtime under the same seed (the anti-drift contract test the design plan asks for).
- **Acceptance:** Closed-loop trace matches a game-runtime run within integration
  tolerance in an automated test. Gate: `npm run qa`.

#### FBC-303 — Root locus view

- **Status:** Todo · **Priority:** P2 · **Depends-on:** FBC-301
- **Problem:** Pole-zero is static; a root locus would show how closed-loop poles move
  with gain — a standard first-course tool.
- **Scope:** Root-locus computation (reuse the Durand–Kerner root finder in
  `pole-zero.ts`) over a gain sweep; SVG plot with stability-boundary cue.
- **Acceptance:** Locus endpoints match open-loop poles/zeros; branch count equals
  system order; reference-system tests. Gate: `npm run qa`.

---

### Phase 4 — UX & accessibility

Confirmed as the third capability priority (OQ-3, 2026-07-04). Items use the next free
IDs in the 4xx block; FBC-401/402 below them are the deferred replay items and keep
their original IDs.

#### FBC-403 — Keyboard and contrast accessibility pass

- **Status:** Todo · **Priority:** P2 · **Depends-on:** FBC-102
- **Problem:** `docs/TEST_GUARDRAILS.md §7` requires keyboard-first operation and
  contrast-compliant charts/overlays; neither has ever been audited or tested.
- **Scope:** Audit both routes for keyboard operability (mode switching, tuning panels,
  preset buttons, disturbance controls) and chart/overlay contrast; fix findings; add an
  automated a11y check (e.g. axe assertions in the E2E suite) for the two pages.
- **Acceptance:** All interactive controls reachable and operable by keyboard; a11y
  check green in CI; chart palettes meet WCAG AA contrast. Gate: `npm run qa`.

#### FBC-404 — Projector-friendly classroom display and progressive disclosure

- **Status:** Todo · **Priority:** P2 · **Depends-on:** FBC-101, FBC-102
- **Problem:** The docs call for legibility "in projector conditions" and progressive
  disclosure to avoid overwhelming students; the current UI shows every control at once
  at laptop-scale sizing.
- **Scope:** A classroom display toggle (larger type, higher contrast, simplified HUD)
  and grouping of advanced controls behind expandable sections; no behaviour change to
  simulation or controllers.
- **Acceptance:** Toggle works on both routes; E2E snapshot of classroom mode; default
  view unchanged. Gate: `npm run qa`.

---

### Deferred — Replay & comparison tooling

Not selected in the owner's 2026-07-04 priority decision (OQ-3). Do not pick these up
until the owner re-prioritizes them; dependencies are kept accurate for that event.

#### FBC-401 — Deterministic run replay

- **Status:** Deferred · **Priority:** P2 · **Depends-on:** FBC-101
- **Problem:** The design promises "replay capability from seed + controller settings";
  run summaries store the ingredients but nothing replays them.
- **Scope:** "Replay" action on a run-history entry: reconstruct engine config, seed,
  and controller snapshot; re-run; assert the score/metrics match the stored summary
  (surfacing any determinism regression to the user).
- **Acceptance:** Replaying a stored run reproduces its score and metrics exactly;
  integration test included. Gate: `npm run qa`.

#### FBC-402 — Side-by-side controller comparison

- **Status:** Deferred · **Priority:** P2 · **Depends-on:** FBC-401
- **Problem:** Comparing controllers currently means playing sequential runs and reading
  a table; the pedagogy wants direct visual comparison under identical disturbances.
- **Scope:** Run two controller configurations headless over the same seed/scenario and
  overlay their altitude/error traces + metric table.
- **Acceptance:** Comparison reproducible for a fixed seed; E2E test of the flow.
  Gate: `npm run qa`.

---

### Dependency graph

```mermaid
graph TD
    subgraph P0["Phase 0 — Stabilize"]
        FBC001[FBC-001 CI]
        FBC002[FBC-002 Toolchain pin]
        FBC003[FBC-003 Coverage]
        FBC004[FBC-004 Scaffold cleanup]
        FBC005[FBC-005 Critical E2E flows]
        FBC006[FBC-006 Art licensing]
        FBC007[FBC-007 Deployment]
    end
    subgraph P1["Phase 1 — Refactor"]
        FBC101[FBC-101 Game session module]
        FBC102[FBC-102 Chart builders]
        FBC103[FBC-103 Scenario catalog]
        FBC104[FBC-104 Engine cleanup]
    end
    subgraph P2["Phase 2 — Pedagogy"]
        FBC201[FBC-201 Guided scenarios]
        FBC202[FBC-202 Concept tooltips]
    end
    subgraph P3["Phase 3 — Analysis depth"]
        FBC301[FBC-301 Margins]
        FBC302[FBC-302 Closed-loop step]
        FBC303[FBC-303 Root locus]
    end
    subgraph P4["Phase 4 — UX & accessibility"]
        FBC403[FBC-403 Keyboard & contrast]
        FBC404[FBC-404 Classroom display]
    end
    subgraph DEF["Deferred (OQ-3)"]
        FBC401[FBC-401 Replay]
        FBC402[FBC-402 Comparison]
    end

    FBC001 --> FBC003
    FBC004 --> FBC005
    FBC001 --> FBC007
    FBC006 --> FBC007
    OQ5([OQ-5]) -.-> FBC007
    FBC005 --> FBC101
    FBC005 --> FBC102
    FBC005 --> FBC202
    FBC101 --> FBC103
    FBC103 --> FBC201
    FBC102 --> FBC301
    FBC102 --> FBC302
    FBC301 --> FBC303
    FBC102 --> FBC403
    FBC101 --> FBC404
    FBC102 --> FBC404
    FBC101 --> FBC401
    FBC401 --> FBC402
```

_(Dropped: FBC-203 run export, per OQ-2.)_

### Open questions for the owner

Answered questions stay here as the decision record; **OQ-5 is the only one still open**.
Answering it (edit this section or tell an agent) unblocks FBC-007.

- **OQ-1 — Deployment target.** ✅ **Answered 2026-07-04: GitHub Pages** via
  `adapter-static`. Implemented by FBC-007 (blocked only on OQ-5 below).
- **OQ-2 — Data strategy.** ✅ **Answered 2026-07-04: localStorage only** — no backend,
  no file export. FBC-203 dropped accordingly.
- **OQ-3 — Capability ordering.** ✅ **Answered 2026-07-04: pedagogy & curriculum,
  analysis depth, and UX & accessibility** (in that phase order). Replay & comparison
  tooling not selected → FBC-401/402 deferred.
- **OQ-4 — Game-art licensing.** ✅ **Answered 2026-07-04: keep the sprites; private
  classroom use accepted.** FBC-006 documents the constraint.
- **OQ-5 — Public Pages vs. private-use sprites (OPEN).** The OQ-1 and OQ-4 answers
  conflict: a GitHub Pages site is publicly reachable, so deploying there serves the
  copyrighted .GEARS sprites to the public — beyond the private-use risk accepted in
  OQ-4. Options: (a) accept the public exposure explicitly; (b) swap in free/original
  assets before deploying (reopens the FBC-006 replace path); (c) revert to the
  primitive-geometry renderer for the deployed build; (d) choose access-restricted
  hosting instead of Pages. Blocks FBC-007.
