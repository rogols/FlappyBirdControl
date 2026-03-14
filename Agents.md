# Agents.md — Multi-Agent Collaboration Guide

This file describes how AI agents should collaborate on FlappyBirdControl, what roles exist, and how to orchestrate multi-agent workflows. All agents must also read **[CLAUDE.md](./CLAUDE.md)** first — it is the canonical source of project conventions, commands, and guardrails.

---

## Relationship to CLAUDE.md

| File | Purpose |
|---|---|
| **CLAUDE.md** | Single agent: commands, conventions, testing rules, guardrails |
| **Agents.md** (this file) | Multi-agent: roles, parallelism rules, handoff contracts, skills |

CLAUDE.md governs what every agent does. Agents.md governs how agents coordinate.

---

## Agent Roles

### 1. Implementer Agent

Writes new features following the roadmap in `docs/SOFTWARE_DESIGN_PLAN.md`.

**Constraints:**
- Work in one module at a time. Do not touch unrelated modules.
- After each logical unit of code, verify with `npm run check && npm run test:unit -- --run`.
- Emit a structured handoff note (see Handoff Contract below) for the Verifier agent.

**Typical task scope:**
- One controller implementation (e.g., `pid-controller.ts` + its tests).
- One analysis function (e.g., `bode.ts` + reference-data tests).
- One Svelte route or component change (e.g., `game/+page.svelte`).

---

### 2. Verifier Agent

Reviews and validates work produced by the Implementer.

**Responsibilities:**
- Run `npm run qa` and report full output.
- Confirm coverage targets met for changed modules.
- Confirm no `NaN`/`Infinity` possible in physics or control paths.
- Confirm no coupling introduced between isolated modules.
- Confirm Playwright E2E suite passes.
- If any check fails: open a task for the Implementer describing exactly what must be fixed.

**Never** approve or merge without a green `npm run qa`.

---

### 3. Analysis/Math Agent

Specialized in the `src/lib/analysis/` and `src/lib/control/` modules.

**When to invoke:**
- Implementing or verifying Bode, step response, pole-zero, or transfer-function math.
- Checking discretization correctness (Tustin / ZOH).
- Reviewing numeric robustness of controller outputs.

**Required output:**
- Unit tests with reference data from an independent calculation (e.g., hand-calculated or cross-checked with a known tool).
- Commentary on numerical stability for the chosen `Δt`.

---

### 4. Test-Writer Agent

Writes or improves tests without changing production code.

**When to invoke:**
- Coverage drops below targets.
- A new scenario needs to be added to the canonical scenario catalog (`docs/TEST_GUARDRAILS.md §11`).
- Playwright E2E flows need updating after a UI change.

**Output format:**
- New test file or additions to existing test file.
- A summary of which scenarios are now covered and their seed values.

---

### 5. Documentation Agent

Keeps docs in sync with implementation.

**When to invoke:**
- A new module, route, or data model is added.
- A controller interface changes.
- A new CLI script or npm command is introduced.

**Scope:** `CLAUDE.md`, `Agents.md`, `docs/*.md`. Does not touch source code.

---

## Parallelism Rules

Agents may work in parallel only when their changes do not overlap:

| Safe to parallelize | Must serialize |
|---|---|
| `control/` implementer + `analysis/` implementer | Anything touching shared `interfaces.ts` or `physics.ts` |
| Unit-test writer + E2E-test writer | Physics model changes (one agent at a time) |
| Documentation agent + any implementer | Changes to `package.json` scripts |
| Different Svelte routes (no shared stores) | Changes to shared UI stores |

When in doubt, serialize. A merge conflict in a physics file is worse than the time saved by parallelism.

---

## Handoff Contract

When an Implementer agent completes a task and passes it to a Verifier (or another agent), it must provide:

```markdown
## Handoff Note

**Task completed:** <one-sentence summary>
**Files changed:** <list of files>
**Tests added/updated:** <list of test files>
**Commands to verify:**
  npm run check
  npm run test:unit -- --run --reporter=verbose
  npm run test:e2e
**Known limitations / follow-up tasks:** <any deferred work>
**Seed used for scenario testing:** <seed value if applicable>
```

---

## Available Skills

These skills are defined for use with Claude Code's Skill tool (`/skill-name`):

### `/simplify`
After implementing a feature, run `/simplify` to review changed code for reuse, quality, and efficiency. Use after completing an Implementer task, before handing off to the Verifier.

### `/session-start-hook`
Sets up a SessionStart hook to ensure tests and linters run automatically at the start of each Claude Code web session. Run once when setting up a new development environment.

---

## Recommended npm Scripts for Agents

| Script | When to use |
|---|---|
| `npm run qa` | **Always** — run before every commit, fastest full gate |
| `npm run check` | After TypeScript changes, before running tests |
| `npm run format` | Before `npm run lint` if formatting errors appear |
| `npm run test:unit -- --run --reporter=verbose` | To see per-test pass/fail detail |
| `npm run test:e2e` | After UI or routing changes |
| `npm run build` | Before a PR targeting `main` to confirm no build regressions |

---

## Multi-Agent Workflow for a Feature Sprint

```
1. Orchestrator assigns task to Implementer Agent
   └─ Implementer reads CLAUDE.md + relevant docs
   └─ Implementer writes code + unit tests
   └─ Implementer runs: npm run check && npm run test:unit -- --run
   └─ Implementer emits Handoff Note

2. Verifier Agent receives Handoff Note
   └─ Verifier runs: npm run qa
   └─ If green → approves, tags for PR
   └─ If red → files fix tasks back to Implementer (never self-fixes)

3. (Optional) Analysis/Math Agent reviews math-heavy modules
   └─ Confirms reference-data tests match independent calculation

4. Documentation Agent updates CLAUDE.md / Agents.md / docs/ if needed

5. PR created with:
   - Handoff Note as PR body template
   - Full npm run qa output pasted
   - Screenshots for any visual change
```

---

## Module Ownership Map

Use this to decide which agent role should handle each directory:

| Directory | Primary role |
|---|---|
| `src/lib/game/` | Implementer (game) |
| `src/lib/control/` | Implementer + Analysis/Math Agent |
| `src/lib/analysis/` | Analysis/Math Agent (primary) |
| `src/lib/telemetry/` | Implementer (game) |
| `src/lib/persistence/` | Implementer |
| `src/lib/ui/` | Implementer (UI) |
| `src/routes/` | Implementer (UI) |
| `e2e/` | Test-Writer Agent |
| `docs/` | Documentation Agent |
| `CLAUDE.md`, `Agents.md` | Documentation Agent |

---

## Escalation Protocol

If an agent is blocked or uncertain:

1. **Stop** — do not make speculative changes to unblock yourself.
2. **Document** the blocker: expected behavior, observed behavior, reproduction steps, seed.
3. **File** a task/issue with the defect tag (`NUMERIC`, `CONTROL`, etc. from CLAUDE.md).
4. **Wait** for human or orchestrator resolution before continuing.

Never introduce a workaround that violates a quality guardrail (e.g., disabling a test, removing a type check, hardcoding a value) to unblock yourself.
