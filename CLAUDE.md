# Claude Agent Configuration

Primary instructions: see **[AGENTS.md](./AGENTS.md)**.

Read `AGENTS.md` fully before making any changes. Everything in `AGENTS.md` applies here without exception.

---

## Claude-Specific Notes

**Skills and subagents** — Claude Code automatically discovers project-specific skills and subagent roles from `.claude/`:

```
.claude/
  skills/
    qa/SKILL.md         → /qa        full quality gate
    diagnose/SKILL.md   → /diagnose  root-cause diagnosis workflow
    handoff/SKILL.md    → /handoff   structured handoff note generator
  agents/
    implementer.md      one-module-at-a-time feature implementer
    verifier.md         quality gate enforcer; never self-fixes
    math.md             control/analysis math specialist
    test-writer.md      tests only; never modifies production code
```

**Behaviour preferences:**
- Prefer incremental edits over full-file rewrites.
- Run `npm run qa` before finalizing any change.
- Use repository scripts (`npm run ...`) rather than raw tool invocations where a script exists.
- When blocked by a bug, run `/diagnose` before touching code.
