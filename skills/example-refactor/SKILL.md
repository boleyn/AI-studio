---
name: example-refactor
description: Refactor code with minimal behavior change and keep patch scope focused.
compatibility: nextjs-ai-studio
metadata:
  audience: developers
  workflow: refactor
---

# Refactor Skill

## Goal

Apply focused refactors while preserving behavior and minimizing risk.

## Workflow

1. Locate affected files and read current implementation before editing.
2. Prefer small, reversible changes over broad rewrites.
3. Preserve external interfaces unless the task explicitly asks to change them.
4. Update related call sites in the same patch when signatures change.
5. Run lint/type checks after modifications.

## Constraints

- Keep existing project conventions and import aliases.
- Avoid introducing unrelated style-only changes.
- If uncertain about behavior impact, add explicit notes in the final summary.
