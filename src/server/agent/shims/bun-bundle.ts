/**
 * Shim for `import { feature } from 'bun:bundle'`.
 *
 * In the original Claude Code (Bun runtime), `feature()` is a compile-time
 * macro that Bun constant-folds to `true/false`, enabling dead-code
 * elimination (DCE) of feature-gated branches.
 *
 * In our Next.js/webpack build, `feature()` reads environment variables at
 * runtime instead. Set `CLAUDE_FEATURE_<NAME>=1` or include the name in
 * the comma-separated `CLAUDE_FEATURES` env var.
 *
 * ⚠️  IMPORTANT: Unlike Bun, webpack bundles ALL code branches regardless
 * of the feature gate result. When a feature IS enabled at runtime, the
 * `require()`-d module may have broken/incomplete exports due to webpack
 * tree-shaking. Only enable features that have been verified to work.
 *
 * ✅ Safe flags (verified in webpack build):
 *   BUILTIN_EXPLORE_PLAN_AGENTS — Explore/Plan sub-agents
 *   ULTRATHINK                  — Extended thinking support
 *   EXTRACT_MEMORIES            — Memory extraction
 *   FORK_SUBAGENT               — Parallel sub-agent execution
 *
 * ❌ Dangerous flags (crash in webpack build — DO NOT enable):
 *   KAIROS, KAIROS_BRIEF        — BriefTool: isBriefEnabled() breaks
 *   VOICE_MODE, BUDDY           — Native audio/companion: missing deps
 *   CHICAGO_MCP                 — Computer-use MCP: native bindings
 *   PROACTIVE                   — Autonomous mode: requires KAIROS
 *   COORDINATOR_MODE            — Multi-agent orchestration
 *   ... and most others from claude-code DEFAULT_BUILD_FEATURES
 */
export const feature = (name: string): boolean => {
  const normalized = String(name || '').trim();
  if (!normalized) return false;
  const exact = process.env[`CLAUDE_FEATURE_${normalized}`];
  if (exact === '1' || exact === 'true') return true;
  if (exact === '0' || exact === 'false') return false;
  const global = process.env.CLAUDE_FEATURES;
  if (!global) return false;
  const enabled = new Set(
    global
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return enabled.has(normalized);
};

