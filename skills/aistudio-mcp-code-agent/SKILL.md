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
   - For website/app creation tasks, you MUST do this sequence before coding:
     - Call `list_files` to understand current project structure.
     - Read `package.json` and `package-lock.json` (if present) to confirm tech stack and package manager conventions.
     - Read existing page/component code to align coding style and architecture patterns.
5. Implement with targeted file edits and keep scope strictly aligned to user intent; if a change is likely >120 lines or mixes concerns, split into multiple files/modules first.
6. Validate with project build/tests when available.
7. Summarize changed files and behavior impact.

## Resource Usage (Built-in Skill Coordination)

- If the request is admin-console style related (后台管理系统/管理台/控制台/仪表盘/列表页), load and apply `b-admin-ui-style` as a companion skill.
- Use resources in this strict order:
  1. External/project constraints from MCP knowledge sources (for example GitLab KB when available).
  2. Local codebase conventions (`package.json`, existing pages/components, current styling system).
  3. Style skill references (`skills/b-admin-ui-style/references/design-tokens.md`).
  4. Style skill assets (`skills/b-admin-ui-style/assets/**`).
- Convert style resources into concrete implementation artifacts:
  - map tokens to CSS variables or theme constants first;
  - then apply them to layout/components;
  - then swap ad-hoc icons/logo with `b-admin-ui-style` bundled assets.
- If MCP knowledge conflicts with style skill defaults, prefer MCP/project constraints and document the override reason in the summary.
- If `b-admin-ui-style` resources are missing, report once and continue with nearest local design system fallback.

## Hard Rules

- Use function call and MCP tools only.
- Avoid prompt-encoded pseudo tool-calling formats.
- Before any tool call, provide a short clarification message (1-2 sentences) describing understanding + immediate plan.
- Use "clarify first, then execute" cadence on coding tasks: brief intent alignment -> tool discovery/read -> implementation.
- Before each major tool batch, provide a short progress update so users can understand why tools are being called.
- Do not run long sequences of tool calls without visible explanatory text.
- Read target files before claiming code changes.
- Avoid one-shot large file writes; if a change is likely >120 lines or spans multiple concerns, split into smaller files/modules first.
- Run MCP reference steps before implementation changes when relevant MCP exists.
- For UI/prototype/code tasks, complete GitLab KB lookup before prototyping and implementation when GitLab KB tools are available.
- Default implementation style for frontend output: follow the current repo/runtime stack detected from files and `package.json` (do not force TypeScript when the project is JavaScript).
- Keep edits scoped to user intent.
- Never hard-code unavailable server/tool names; always bind workflow to discovered capabilities in the current turn.
- Sandpack static assets MUST follow Context7-verified rule set:
  - MUST enable `experimental_enableServiceWorker: true` on every relevant `SandpackProvider`/`Sandpack`.
  - MUST place static assets under `/public`.
  - MUST use Sandpack-compatible runtime paths for those assets (for this project, follow `/public/...` convention used by Sandpack static-files docs/examples).
  - NEVER assume Next.js `public` path behavior is identical inside Sandpack runtime.

## Project Conventions (Must Follow)

- Always infer conventions from the current target project's files and dependencies first; never force a framework layout.
- Framework detection priority:
  - If `package.json` has `next`, follow Next.js Pages Router conventions (`src/pages/**`, `src/pages/api/**`, etc.).
  - If target is Sandpack React SPA (and no `next`), follow this workspace default scaffold.
- Workspace default React scaffold (authoritative):
  - root: `/App.js`, `/index.js`, `/public/index.html`, `/styles.css`
  - avoid Vite-only files by default (`/src/main.jsx`, `/vite.config.js`, `/index.html` as Vite entry)
- Do not apply Next.js folder rules to a React SPA scaffold.
- Do not create a second conflicting source root when an existing one is already established.
- Before finishing coding tasks, call `compile_project` to verify runtime/compile status and fix blocking errors.

## Tool Strategy

- Prefer fast search (`rg` or equivalent) before broad file reads.
- Prefer targeted patch/edit operations over full-file rewrites.
- Use file creation/write only when adding new files or intentionally replacing complete content.
- Use multiple tools in parallel only when operations are independent.

## Failure / Fallback

- If a referenced MCP server is not available in the current session, report it briefly and continue with available MCP + local code workflow.
- If a required tool name in this skill doesn't exist in the current runtime, map the step to the closest available tool and continue.
- Do not block implementation solely because one optional MCP source is unavailable.
