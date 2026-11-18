import type { ToolDefinition } from "./types";

// Deterministic lexical retrieval: exact identifiers + BM25 + bilingual domain
// hints. This does not pretend to be a semantic embedding service.
const aliases: Array<[RegExp, string]> = [
  [/文件|读取|写入|修改|目录|搜索文件/, "file read write edit glob grep"],
  [/网页|网站|联网|搜索网页/, "web fetch search"],
  [/计划|规划|待办/, "plan todo"], [/技能/, "skill"],
  [/发票|开票/, "invoice finance"], [/客户|商机/, "customer crm leads"],
  [/子任务|子智能体|委派/, "agent delegate"], [/记忆|偏好/, "memory"],
];
const tokenize = (text: string): string[] => {
  const normalized = text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const terms = normalized.match(/[a-z0-9]+|[\p{Script=Han}]/gu) || [];
  return terms;
};

export function rankTools(tools: ToolDefinition<any>[], query: string) {
  const expanded = `${query} ${aliases.filter(([re]) => re.test(query)).map(([, terms]) => terms).join(" ")}`;
  const terms = [...new Set(tokenize(expanded))];
  const documents = tools.map(tool => ({ tool, words: tokenize(`${tool.name} ${tool.toolset} ${tool.description}`) }));
  const averageLength = documents.reduce((sum, doc) => sum + doc.words.length, 0) / Math.max(1, documents.length);
  const frequency = new Map(terms.map(term => [term, documents.filter(doc => doc.words.includes(term)).length]));
  return documents.map(({ tool, words }) => {
    let score = tool.name.toLowerCase() === query.trim().toLowerCase() ? 1000 : 0;
    for (const term of terms) {
      const tf = words.filter(word => word === term).length;
      if (!tf) continue;
      const df = frequency.get(term) || 0;
      const idf = Math.log(1 + (tools.length - df + 0.5) / (df + 0.5));
      score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * words.length / Math.max(1, averageLength)));
      if (tokenize(tool.name).includes(term)) score += 2;
    }
    return { tool, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}
