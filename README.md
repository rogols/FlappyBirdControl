# Flappy Bird Control Lab

A SvelteKit + Three.js educational web app for teaching introductory control theory through a Flappy Bird-inspired sandbox.

## Project intent

Students should be able to:

- play manually,
- compare automatic controllers (On-Off, PID, generic transfer-function controller),
- inspect analysis views (ODE, step response, Bode, pole-zero), and
- learn through rich debug visualizations in game context.

## Planning documentation

- [Software Design Plan](docs/SOFTWARE_DESIGN_PLAN.md)
- [Test Guardrails and Quality Strategy](docs/TEST_GUARDRAILS.md)
- [Development Workflow and Quality Sprints](docs/DEVELOPMENT_WORKFLOW.md)
- [Onboarding Guide](docs/ONBOARDING.md)

## Developing

```sh
npm install
npm run dev
```

## Quality checks

```sh
npm run check
npm run lint
npm run test
```

## Build

```sh
npm run build
npm run preview
```
