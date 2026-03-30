import { z } from "zod";

export const searchInFilesSchema = z.object({
  query: z.string().min(1, "query 不能为空"),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  includeGlobs: z.array(z.string().min(1)).max(32).optional(),
  excludeGlobs: z.array(z.string().min(1)).max(32).optional(),
  contextLines: z.number().int().min(0).max(5).optional(),
  maxResults: z.number().int().min(1).max(500).optional(),
});

export type SearchInFilesInput = z.infer<typeof searchInFilesSchema>;

type SearchMatch = {
  line: number;
  column: number;
  snippet: string;
  before?: string[];
  after?: string[];
};

type SearchResultFile = {
  path: string;
  matches: SearchMatch[];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globToRegExp = (glob: string) => {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    const next = glob[i + 1];
    if (ch === "*" && next === "*") {
      out += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegExp(ch);
  }
  out += "$";
  return new RegExp(out);
};

const createGlobMatchers = (globs?: string[]) => (globs || []).map((glob) => globToRegExp(glob.trim()));

const pathMatches = (path: string, include: RegExp[], exclude: RegExp[]) => {
  if (include.length > 0 && !include.some((matcher) => matcher.test(path))) {
    return false;
  }
  if (exclude.some((matcher) => matcher.test(path))) {
    return false;
  }
  return true;
};

const buildPattern = ({
  query,
  regex,
  wholeWord,
}: {
  query: string;
  regex: boolean;
  wholeWord: boolean;
}) => {
  const base = regex ? query : escapeRegExp(query);
  if (!wholeWord) return base;
  return `\\b(?:${base})\\b`;
};

export const runSearchInFiles = ({
  files,
  input,
}: {
  files: Record<string, { code: string }>;
  input: SearchInFilesInput;
}) => {
  const regex = input.regex !== false;
  const caseSensitive = input.caseSensitive === true;
  const wholeWord = input.wholeWord === true;
  const contextLines = input.contextLines ?? 0;
  const maxResults = input.maxResults ?? 200;

  const include = createGlobMatchers(input.includeGlobs);
  const exclude = createGlobMatchers(input.excludeGlobs);

  const source = buildPattern({ query: input.query, regex, wholeWord });
  let matcher: RegExp;
  try {
    matcher = new RegExp(source, caseSensitive ? "g" : "gi");
  } catch {
    throw new Error("query 正则表达式无效");
  }

  const results: SearchResultFile[] = [];
  let totalMatches = 0;
  let filesSearched = 0;
  let truncated = false;

  const sortedPaths = Object.keys(files).sort((a, b) => a.localeCompare(b));
  for (const path of sortedPaths) {
    if (!pathMatches(path, include, exclude)) continue;

    filesSearched += 1;
    const code = typeof files[path]?.code === "string" ? files[path].code : "";
    if (!code) continue;

    const lines = code.split(/\r?\n/);
    const fileMatches: SearchMatch[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] || "";
      matcher.lastIndex = 0;
      let found = matcher.exec(line);
      while (found) {
        const matchLength = found[0]?.length || 0;
        const lineNumber = i + 1;
        const column = found.index + 1;
        const entry: SearchMatch = {
          line: lineNumber,
          column,
          snippet: line.trim().slice(0, 500),
        };

        if (contextLines > 0) {
          const beforeStart = Math.max(0, i - contextLines);
          const beforeLines = lines.slice(beforeStart, i);
          const afterLines = lines.slice(i + 1, i + 1 + contextLines);
          if (beforeLines.length > 0) entry.before = beforeLines;
          if (afterLines.length > 0) entry.after = afterLines;
        }

        fileMatches.push(entry);
        totalMatches += 1;
        if (totalMatches >= maxResults) {
          truncated = true;
          break;
        }

        if (matchLength === 0) {
          matcher.lastIndex += 1;
        }
        found = matcher.exec(line);
      }

      if (truncated) break;
    }

    if (fileMatches.length > 0) {
      results.push({ path, matches: fileMatches });
    }
    if (truncated) break;
  }

  return {
    ok: true,
    action: "search",
    message: `搜索 "${input.query}" 完成${truncated ? "（结果已截断）" : ""}。`,
    data: {
      query: input.query,
      options: {
        regex,
        caseSensitive,
        wholeWord,
        includeGlobs: input.includeGlobs || [],
        excludeGlobs: input.excludeGlobs || [],
        contextLines,
        maxResults,
      },
      filesSearched,
      filesMatched: results.length,
      totalMatches,
      truncated,
      results,
    },
  };
};
