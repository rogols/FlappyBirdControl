# Onboarding Guide

## 1) Project Mission

Flappy Bird Control Lab is a teaching-oriented web app where control theory concepts become interactive through gameplay and controller design experimentation.

Read first:

1. `docs/SOFTWARE_DESIGN_PLAN.md`
2. `docs/TEST_GUARDRAILS.md`
3. `docs/DEVELOPMENT_WORKFLOW.md`

## 2) Local Setup

Prerequisites:

- Node.js LTS
- npm

Setup:

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run check
npm run lint
npm run test
```

## 3) First Contribution Path

Recommended first tasks:

- Improve one small debug overlay.
- Add one deterministic controller unit test.
- Improve one analysis-view label or tooltip.

## 4) Coding and Design Expectations

- Use clear TypeScript interfaces and pure functions for math-heavy code.
- Keep controller logic isolated from rendering code.
- Avoid hidden coupling between analysis and game modules.
- Favor explicit naming over shorthand in educational code paths.

## 5) Testing Expectations by Change Type

- Controller logic change: unit + integration scenario required.
- Analysis math change: unit tests with known reference data.
- UI/gameplay change: e2e or component test + screenshot evidence.
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
