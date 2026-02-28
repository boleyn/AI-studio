---
name: aistudio-mcp-code-workflow
description: This skill should be used when the user asks to implement, fix, refactor, or analyze code in this project and requires MCP-first reference discovery. Trigger when requests involve “改代码”, “修复 bug”, “实现功能”, “重构”, “按参考页实现”, or similar coding tasks.
version: 0.1.0
---

# AI Studio MCP-first Coding Workflow

Follow this skill for coding tasks in this repository.

## Required Input

- User request text.
- Available tools list for current turn.

## Execution Workflow

1. **Discover capabilities first**: inspect available MCP servers and tools in this turn before choosing a workflow.
2. **Project knowledge first (GitLab KB mandatory when available)**:
   - Before prototyping or coding, query project knowledge using:
     - `mcp_mcp-gitlab-kb__list_projects` to discover available KB projects.
     - `mcp_mcp-gitlab-kb__get_project_details` to get project details (analysis/UI scope, constraints).
     - `mcp_mcp-gitlab-kb__get_analysis_page` to read relevant technical analysis pages.
3. **Prototype after knowledge lookup**:
   - Build or refine the prototype only after KB facts are collected and aligned with user intent.
4. Inspect local code with available local tools (shell/file search/read/edit) and keep reads minimal.
5. Implement with targeted file edits and keep scope strictly aligned to user intent.
6. Validate with project build/tests when available.
7. Summarize changed files and behavior impact.

## Hard Rules

- Use function call and MCP tools only.
- Avoid prompt-encoded pseudo tool-calling formats.
- Read target files before claiming code changes.
- Run MCP reference steps before implementation changes when relevant MCP exists.
- For UI/prototype/code tasks, complete GitLab KB lookup before prototyping and implementation when GitLab KB tools are available.
- Default implementation style for frontend output: `React + TypeScript`, functional components, and hook-based state management.
- Keep edits scoped to user intent.
- Never hard-code unavailable server/tool names; always bind workflow to discovered capabilities in the current turn.

## Tool Strategy

- Prefer fast search (`rg` or equivalent) before broad file reads.
- Prefer targeted patch/edit operations over full-file rewrites.
- Use file creation/write only when adding new files or intentionally replacing complete content.
- Use multiple tools in parallel only when operations are independent.

## Failure / Fallback

- If a referenced MCP server is not available in the current session, report it briefly and continue with available MCP + local code workflow.
- If a required tool name in this skill doesn't exist in the current runtime, map the step to the closest available tool and continue.
- Do not block implementation solely because one optional MCP source is unavailable.
