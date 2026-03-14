# Development Workflow and Quality Sprints

## 1) Workflow Principles

- Keep changes small, testable, and reviewable.
- Design before coding for control-theory features.
- Preserve deterministic simulation behavior at all times.
- Treat documentation updates as first-class deliverables.

## 2) Suggested Sprint Cadence

## 2.1 Sprint Types

1. **Feature Sprint**
   - Adds scoped capability (e.g., PID overlays).
2. **Quality Sprint**
   - Hardens tests, performance, accessibility, and docs.
3. **Curriculum Sprint**
   - Improves pedagogy: examples, presets, conceptual explanations.

Cycle suggestion: 2 Feature sprints + 1 Quality sprint repeating.

## 2.2 Sprint Ceremonies (lightweight)

- Planning: pick 1–3 high-impact backlog items.
- Mid-sprint checkpoint: verify quality gates remain green.
- Review: demo both game behavior and analysis view outputs.
- Retrospective: capture technical and teaching insights.

## 3) Backlog Structure

Track work in epics:

- EPIC-A: Game core and rendering evolution
- EPIC-B: Controllers and runtime stability
- EPIC-C: Analysis/design tooling
- EPIC-D: Debug overlays and telemetry
- EPIC-E: Quality, tests, and CI
- EPIC-F: Educational content and onboarding

Each ticket should include acceptance criteria, test evidence, and pedagogy impact.

## 4) Definition of Ready (DoR)

A task is ready when it has:

- Problem statement tied to learning goal.
- Scope boundaries and non-goals.
- Impacted modules identified.
- Test strategy defined (unit/integration/e2e).
- UX expectation if UI affected.

## 5) Definition of Done (DoD)

A task is done when:

- Implementation merged.
- Required tests added/updated and green.
- Relevant docs updated.
- Performance/accessibility not regressed.
- Demo path reproducible by another team member.

## 6) Branching and PR Standards

Branch naming example:

- `feat/pid-overlay-internals`
- `fix/tf-controller-clamp-nan`
- `docs/analysis-view-spec`

PR checklist:

- Summary and rationale
- Screenshots/video for UI changes
- Note whether contribution was human-authored, AI-assisted, or AI-authored
- Test commands + results (including Playwright e2e)
- Risks and rollback considerations
- Follow-up tasks (if deferred)

## 7) Release Strategy

- Tag minor releases for teaching milestones (`v0.1`, `v0.2`, `v1.0`).
- Maintain changelog grouped by educator/student-facing impact.
- Keep a stable classroom release branch during teaching periods.

## 8) Incident and Bug Response

For critical classroom bugs:

1. Reproduce with deterministic seed.
2. Add failing automated test.
3. Implement fix with minimal scope.
4. Verify no regression in key scenarios.
5. Document root cause and prevention step.
