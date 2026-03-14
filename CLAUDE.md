# Claude Agent Configuration

Primary instructions: see **[AGENTS.md](./AGENTS.md)**.

Read `AGENTS.md` fully before making any changes. Everything in `AGENTS.md` applies here without exception.

---

## Claude-Specific Notes

**Skills and subagents** — Claude Code automatically discovers project-specific skills and subagent roles from `.claude/`. These are the Claude Code implementations of the workflows and roles defined in `AGENTS.md`:

| AGENTS.md concept | Claude Code implementation |
|---|---|
| Quality gate workflow | `/qa` → `.claude/skills/qa/SKILL.md` |
| Diagnosis workflow | `/diagnose` → `.claude/skills/diagnose/SKILL.md` |
| Handoff workflow | `/handoff` → `.claude/skills/handoff/SKILL.md` |
| implementer role | `.claude/agents/implementer.md` |
| verifier role | `.claude/agents/verifier.md` |
| math role | `.claude/agents/math.md` |
| test-writer role | `.claude/agents/test-writer.md` |

**Behaviour note:** When blocked by a bug, invoke the `/diagnose` skill before touching any code. This is the Claude Code implementation of the diagnosis workflow defined in `AGENTS.md §Debugging and Problem-Solving Philosophy`.
