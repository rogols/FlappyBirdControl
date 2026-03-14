# Agents.md — Multi-Agent Collaboration Guide

This file is the navigational index for AI agent collaboration on FlappyBirdControl. All agents must also read **[CLAUDE.md](./CLAUDE.md)** first — it is the canonical source of project conventions, commands, and guardrails.

Executable agent roles and workflow skills live in `.claude/` and are loaded automatically by Claude Code.

---

## Relationship to CLAUDE.md

| File                      | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| **CLAUDE.md**             | Single agent: commands, conventions, testing rules, guardrails         |
| **Agents.md** (this file) | Multi-agent: directory map, roles, parallelism rules, handoff contract |
| **`.claude/agents/`**     | Subagent definitions — loaded by Claude Code automatically             |
| **`.claude/skills/`**     | Reusable workflow skills — invoked as `/skill-name` slash commands     |

CLAUDE.md governs what every agent does. Agents.md governs how agents coordinate.

> **Core principle (enforced across all roles):** When a bug or error is found, diagnose it at its root cause and fix it there. Do not add workarounds, guards, retries, or extra layers to compensate for undiagnosed faults. See **CLAUDE.md § Debugging and Problem-Solving Philosophy** for the required process and a table of prohibited responses.

---

## Skills (slash commands)

Project-specific skills live in `.claude/skills/`. Each creates a `/skill-name` slash command.

| Command     | File                               | When to use                                                                                 |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `/qa`       | `.claude/skills/qa/SKILL.md`       | Before every commit — runs the full quality gate and reports results                        |
| `/diagnose` | `.claude/skills/diagnose/SKILL.md` | When a bug is found — guides systematic root-cause diagnosis before any code is touched     |
| `/handoff`  | `.claude/skills/handoff/SKILL.md`  | After completing an implementation — generates a structured handoff note for the next agent |

Bundled Claude Code skills also available in this project:

| Command               | When to use                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `/simplify`           | After implementing a feature — reviews changed code for quality, reuse, and efficiency |
| `/session-start-hook` | Once per environment setup — ensures tests and linters run at session start            |

---

## Subagents (agentic roles)

Project-specific subagents live in `.claude/agents/`. Each is a focused role with its own system prompt, tool restrictions, and scope.

| Agent         | File                            | Responsibility                                                                                |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `implementer` | `.claude/agents/implementer.md` | Writes features; works in one module at a time; runs `/qa` + `/handoff` on completion         |
| `verifier`    | `.claude/agents/verifier.md`    | Validates implementer output; runs full quality gate; rejects workarounds; never self-fixes   |
| `math`        | `.claude/agents/math.md`        | Control and analysis math specialist — Bode, step response, discretization, numeric stability |
| `test-writer` | `.claude/agents/test-writer.md` | Writes and improves tests; does not modify production code                                    |

---

## Typical feature workflow

```
1. Orchestrator assigns task to → implementer agent
   └─ reads CLAUDE.md + relevant docs
   └─ writes code + unit tests (one module at a time)
   └─ runs: npm run check && npm run test:unit -- --run
   └─ for math-heavy work: delegates to → math agent
   └─ runs /qa → must be green
   └─ runs /handoff → produces handoff note

2. Handoff note passed to → verifier agent
   └─ runs /qa and reports full output
   └─ checks coverage, numeric robustness, module coupling
   └─ checks for workarounds (rejects any found)
   └─ APPROVED → tag for PR
   └─ RETURNED → files specific fix tasks back to implementer

3. (Optional) → test-writer agent
   └─ invoked if coverage drops or new scenarios needed
   └─ does not touch production code

4. PR created with handoff note as body template + npm run qa output pasted
```

---

## Parallelism rules

Agents may work in parallel only when their changes do not overlap:

| Safe to parallelize                              | Must serialize                                           |
| ------------------------------------------------ | -------------------------------------------------------- |
| `control/` implementer + `analysis/` implementer | Anything touching shared `interfaces.ts` or `physics.ts` |
| Unit-test writer + E2E-test writer               | Physics model changes (one agent at a time)              |
| Different Svelte routes with no shared stores    | Changes to shared UI stores                              |
| Documentation updates + any implementer          | Changes to `package.json` scripts                        |

When in doubt, serialize. A merge conflict in a physics file costs more than the time saved by parallelism.

---

## Handoff contract

When an implementer completes a task, run `/handoff` to produce:

```markdown
## Handoff Note

**Task completed:** <one sentence>
**Files changed:** <list with one-line description each>
**Tests added / updated:** <list with scenario description each>
**Commands to verify:**
npm run check
npm run test:unit -- --run --reporter=verbose
npm run test:e2e
**Seed used for scenario testing:** <seed value or N/A>
**Known limitations / follow-up tasks:** <any deferred work>
```

---

## Module ownership

| Directory                                     | Primary agent                               |
| --------------------------------------------- | ------------------------------------------- |
| `src/lib/game/`                               | implementer                                 |
| `src/lib/control/`                            | implementer + math                          |
| `src/lib/analysis/`                           | math (primary)                              |
| `src/lib/telemetry/`                          | implementer                                 |
| `src/lib/persistence/`                        | implementer                                 |
| `src/lib/ui/`                                 | implementer                                 |
| `src/routes/`                                 | implementer                                 |
| `e2e/`                                        | test-writer                                 |
| `docs/`, `CLAUDE.md`, `Agents.md`, `.claude/` | documentation (human or docs-focused agent) |

---

## Escalation protocol

If an agent is blocked or uncertain:

1. **Stop** — do not make speculative changes to unblock yourself.
2. **Diagnose** — run `/diagnose`. Trace the data path and state in plain language why the wrong behaviour occurs. If you cannot state the cause clearly, you do not understand it yet.
3. **Document** the blocker: expected behaviour, observed behaviour, what has been ruled out, reproduction steps, and seed value.
4. **File** a task/issue with the defect tag (`NUMERIC`, `CONTROL`, `ANALYSIS`, `RENDER`, `UX`, `PERF`).
5. **Wait** for human or orchestrator resolution before continuing.

**Never** introduce a workaround to unblock yourself — no disabled tests, no suppressed type errors, no hardcoded values, no downstream clamps. An undiagnosed bug clearly documented is a better outcome than a patched bug whose root cause is still present.
