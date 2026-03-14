---
name: handoff
description: Generate a structured handoff note after completing an implementation task, for the Verifier agent or next agent in the pipeline.
allowed-tools: Bash, Glob
---

Generate a handoff note for the work just completed. Gather the required information, then output the note in the format below.

```bash
git diff --name-only HEAD~1 HEAD
```

```bash
npm run test:unit -- --run --reporter=verbose 2>&1 | tail -20
```

Output the handoff note in this exact format:

---

## Handoff Note

**Task completed:** [one sentence]

**Files changed:**

- [list each file with a one-line description of what changed]

**Tests added / updated:**

- [list each test file and what scenario it covers]

**Commands to verify:**

```bash
npm run check
npm run test:unit -- --run --reporter=verbose
npm run test:e2e
```

**Seed used for scenario testing:** [seed value, or "N/A" if no seeded simulation involved]

**Known limitations / follow-up tasks:**

- [any deferred work or known gaps]

---

Do not mark a handoff complete if `npm run qa` is not green. Run `/qa` first if unsure.
