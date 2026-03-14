---
name: qa
description: Run the full quality gate (check + lint + unit tests + e2e). Use before every commit or when asked to verify the codebase is green.
allowed-tools: Bash
---

Run the full quality gate and report results.

Execute the following steps in order, stopping at the first failure and reporting exactly what failed and why:

```bash
npm run check
```

If that passes:

```bash
npm run lint
```

If that passes:

```bash
npm run test:unit -- --run --reporter=verbose
```

If that passes:

```bash
npm run test:e2e
```

After all steps, report:
- Which steps passed
- If any step failed: the exact error output, which file and line caused it, and what needs to be fixed
- Final status: GREEN (all pass) or RED (first failure point)

Do not attempt to fix anything during this skill — only report. Fixing is a separate task.
