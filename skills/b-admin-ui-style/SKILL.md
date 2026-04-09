---
name: b-admin-ui-style
description: Generate and implement modern B-end (enterprise admin) interface style with Ant Design/Element Plus-like visual language. Use when tasks mention 后台管理系统, 管理台, 控制台, 仪表盘, 列表页, 数据表格, 运营平台, IoT/运维平台, or require “专业、稳定、简约”的企业级 UI 风格统一.
---

# B-End Admin UI Style

Use this skill to keep enterprise dashboard UI visually consistent, production-friendly, and reusable.

## Quick Workflow

1. Identify page type first: dashboard, table list, detail form, settings page.
2. Apply token system from `references/design-tokens.md` before writing UI.
3. Reuse bundled icons and logo from `assets/` instead of ad-hoc assets.
4. Build layout in this order: sidebar -> topbar -> page header -> filter/search bar -> card/table content -> action footer.
5. Validate desktop first, then mobile fallback (at least 1280px and 375px).

## Style Rules

### Color and atmosphere

- Use primary blue as brand/action emphasis: `#5B7FFF`.
- Use light cool background for application shell: `#F4F7FC`.
- Keep cards and tables on white surfaces for contrast.
- Use semantic colors only for state meaning:
  - danger: delete/reject
  - warning: pending
  - success: pass/online
- Avoid large saturated color blocks unless they represent KPI status.

### Typography and spacing

- Prioritize clarity and hierarchy over decorative typography.
- Keep text levels stable:
  - page title
  - section title
  - body text
  - helper/meta text
- Use 4/8-based spacing rhythm.
- Keep dense-but-readable table spacing (row height around 40-48px).

### Components

- Sidebar: compact, clear icon+label navigation, active item with tinted background.
- Tabs: closable task-style tabs are allowed for multi-task pages.
- Filters: rounded rectangular controls with consistent control height.
- Cards: subtle radius and soft shadow; avoid heavy elevation.
- Tables: strong header contrast + lightweight row separators.
- Operations column: prefer text buttons with semantic colors.
- Status tags: tinted background + darker foreground text.

### Icons and visual language

- Use line-style icons as default.
- Keep icon stroke weight and sizing consistent.
- Show badge/red-dot only for actionable alerts.

## Do and Don't

- Do keep the UI function-first and information-dense with controlled whitespace.
- Do keep the page structure predictable across modules.
- Do reuse `assets/logo/logo.svg` as the default brand mark.
- Don't mix unrelated icon families in the same page.
- Don't overuse gradients, glassmorphism, or oversized shadows.
- Don't use colorful charts/backgrounds unless data semantics require it.

## Resources

- Logo: `assets/logo/logo.svg`
- Common icons: `assets/icons/outline/*.svg`
- Design tokens and usage guidance: `references/design-tokens.md`

## How To Use Resources

1. Read `references/design-tokens.md` first and establish page-level tokens before writing any UI.
2. Materialize tokens as implementation primitives:
   - CSS custom properties (preferred for plain CSS/Sandpack pages), or
   - theme constants/tokens (for component libraries).
3. Reuse assets from `assets/` directly:
   - brand/logo from `assets/logo/logo.svg`;
   - line icons from `assets/icons/outline/*.svg`;
   - avoid mixing third-party icon sets in the same screen unless required by existing codebase.
4. Keep replacement strategy deterministic:
   - first shell layout (sidebar/topbar/background),
   - then control styles (filters/forms/buttons),
   - then data components (cards/tables/tags),
   - finally icon/logo replacement.
5. If a requested component is not covered by local assets, follow local project UI library first, then create minimal compatible fallback styles using existing tokens.

## Resource Constraints (MUST)

- MUST treat this skill's `references/` and `assets/` as the default style source for admin pages.
- MUST respect host runtime static-file constraints before applying visual assets:
  - In Sandpack runtime, static assets MUST be in `/public` and service worker static serving must be enabled by host config.
  - Do not assume host Next.js static path conventions automatically apply in embedded Sandpack preview.
- MUST prioritize consistency over novelty: tokenize first, then layout, then components, then icons/logo.
- NEVER mix arbitrary icon packs when `assets/icons/outline/*.svg` can satisfy the need.
