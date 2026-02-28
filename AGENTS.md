## Skills
A skill is a set of local instructions stored in a `SKILL.md` file.

### Available skills
- project-context-bootstrap: Force a project-fact bootstrap pass before implementation. (file: ~/.codex/skills/project-context-bootstrap/SKILL.md)
- skill-creator: Guide for creating effective skills. (file: ~/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into `$CODEX_HOME/skills`. (file: ~/.codex/skills/.system/skill-installer/SKILL.md)
- aistudio-mcp-code-workflow: Standard AI Studio coding workflow skill for MCP-first implementation sequence. (file: skills/aistudio-mcp-code-workflow/SKILL.md)

### How to use skills
- Discovery: The list above is the available skills for this project.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text), use that skill in this turn.
- Missing/blocked: If a named skill is unavailable, report briefly and continue with best fallback.
- Progressive disclosure: Read only required parts of each skill and only load extra references when needed.
- Coordination: If multiple skills apply, use the minimal set and state execution order.
- Context hygiene: Keep loaded context small; avoid bulk-loading unrelated references.
