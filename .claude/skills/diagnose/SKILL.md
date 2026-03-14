---
name: diagnose
description: Guide systematic root-cause diagnosis of a bug or unexpected behaviour. Use when a bug is reported or a test fails, before touching any code.
allowed-tools: Read, Grep, Glob, Bash
---

You are about to diagnose a bug. Follow these steps strictly. Do not touch production code until step 4 is complete.

## Step 1 — Reproduce deterministically

Identify the exact inputs that trigger the failure every time:
- If it involves the simulation: find the seed, step count, and controller settings.
- If it involves a test: run the specific test in isolation and confirm it fails reliably.

```bash
npm run test:unit -- --run --reporter=verbose --grep "<test name>"
```

State clearly: "The failure reproduces with: [inputs/seed/command]."
If you cannot reproduce it reliably, stop here. Do not proceed to step 2.

## Step 2 — Trace the data path

Read the relevant source files. Trace the data from input to the point where the wrong value appears:
- What value is produced?
- What value was expected?
- At which exact file and line does the value first become wrong?

Do not look at symptoms. Find the origin.

## Step 3 — State the root cause in plain language

Write one or two sentences:
> "The bug is caused by [X] in [file:line]. It produces [wrong value] when [condition], because [reason]."

If you cannot write this statement with confidence, you do not yet understand the cause. Return to step 2.

## Step 4 — Confirm the fix location

Identify the single place where the fix belongs — the origin of the incorrect value, not a downstream location where its effects are visible.

State: "The fix belongs in [file:line]. The change is [description]."

Only after completing all four steps should you proceed to implement the fix.

## What is not allowed during diagnosis

- Do not add `try/catch`, `|| default`, or any guard around the symptom.
- Do not clamp a value downstream to hide upstream bad math.
- Do not widen a test tolerance to make a red test go green.
- Do not add a special-case `if` for the specific bad input.
- Do not delete or skip the failing test.
