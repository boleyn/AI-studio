# Design Tokens (B-End Admin)

Use these tokens as defaults for admin dashboards.

## Color Tokens

```css
:root {
  --bg-app: #f4f7fc;
  --bg-card: #ffffff;
  --bg-sidebar: #ffffff;

  --color-primary: #5b7fff;
  --color-primary-hover: #4a6fff;
  --color-primary-soft: #eef2ff;

  --text-title: #1f2430;
  --text-body: #4b5565;
  --text-muted: #8a94a6;

  --border-default: #e6ebf2;
  --border-strong: #d8dfeb;

  --success: #19be6b;
  --warning: #ff9f43;
  --danger: #f56c6c;
  --info: #409eff;

  --tag-info-bg: #eef4ff;
  --tag-info-text: #3f66d5;
  --tag-danger-bg: #fff1f0;
  --tag-danger-text: #d14343;
}
```

## Radius and Shadow

```css
:root {
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;

  --shadow-card: 0 4px 12px rgba(20, 32, 61, 0.06);
  --shadow-popover: 0 8px 24px rgba(20, 32, 61, 0.12);
}
```

## Spacing and Sizing

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --control-height: 36px;
  --table-row-height: 44px;
  --sidebar-width: 216px;
  --topbar-height: 56px;
}
```

## Typography

- Prefer: `"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`
- Title (page): `20px / 600`
- Section title: `16px / 600`
- Body: `14px / 400`
- Meta/helper: `12px / 400`

## Status Style Pattern

- Success: light green background + deep green text.
- Warning: light orange background + deep orange text.
- Danger: light red background + deep red text.
- Info/Latest: light blue background + deep blue text.

## Table Pattern

- Header background: `#f8fafd`
- Row divider: `1px solid var(--border-default)`
- Hover row background: `#f8fbff`
- Operation column: text buttons with `var(--color-primary)` and `var(--danger)`

