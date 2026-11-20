import type { ParsedUrlQuery } from "querystring";

export type WorkspaceView = "chat" | "library" | "projects" | "schedules";

export type ParsedWorkspaceRoute = {
  view: WorkspaceView;
  conversationId?: string;
};

export type WorkspaceLocation = {
  href: { pathname: string; query: Record<string, string | string[]> };
  as?: string;
};

function normalizePathname(asPath: string): string {
  const withoutHash = asPath.split("#")[0] || "/";
  const pathname = withoutHash.split("?")[0] || "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function getSingleQuery(
  query: ParsedUrlQuery | Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const val = query[key];
  if (typeof val === "string" && val.trim()) return val;
  if (Array.isArray(val) && typeof val[0] === "string" && val[0].trim()) return val[0];
  return undefined;
}

/**
 * 解析当前工作区路由（对齐 ChatGPT 路径规范，同时向下兼容旧的 ?view= / ?conversation= 参数）：
 * - /                  -> chat (新聊天/主页)
 * - /c/:conversationId -> chat (指定会话)
 * - /library           -> library (资料空间)
 * - /projects          -> projects (项目列表)
 * - /schedules         -> schedules (定时任务)
 */
export function parseWorkspaceRoute(
  asPath: string,
  query: ParsedUrlQuery = {},
): ParsedWorkspaceRoute {
  const pathname = normalizePathname(asPath);

  if (pathname === "/library") {
    return { view: "library" };
  }
  if (pathname === "/projects") {
    return { view: "projects" };
  }
  if (pathname === "/schedules") {
    return { view: "schedules" };
  }
  if (pathname.startsWith("/c/")) {
    const rawId = pathname.slice(3).split("/")[0];
    if (rawId) {
      try {
        return { view: "chat", conversationId: decodeURIComponent(rawId) };
      } catch {
        return { view: "chat", conversationId: rawId };
      }
    }
    return { view: "chat" };
  }

  const queryView = getSingleQuery(query, "view");
  if (queryView === "library" || queryView === "projects" || queryView === "schedules") {
    return { view: queryView };
  }

  return {
    view: "chat",
    conversationId: getSingleQuery(query, "conversation"),
  };
}

function serializeQuery(params: Record<string, string | string[]>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== "") sp.append(key, item);
      }
    } else if (value !== undefined && value !== "") {
      sp.set(key, value);
    }
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

/**
 * 构建 Next.js shallow 导航所需的 { href, as }：
 * - href 保持当前页面路由（如 /），避免跨页卸载 AgentWorkspace 导致流式生成中断
 * - as 呈现 ChatGPT 风格的干净语义化路径（/、/c/:id、/library、/projects、/schedules）
 */
export function buildWorkspaceLocation(
  currentPathname: string,
  options: {
    view: WorkspaceView;
    conversationId?: string;
    extraQuery?: Record<string, string | string[] | undefined>;
  },
): WorkspaceLocation {
  const { view, conversationId, extraQuery = {} } = options;

  const cleanExtra: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(extraQuery)) {
    if (key === "view" || key === "conversation" || key === "di") continue;
    if (value === undefined) continue;
    if (typeof value === "string" && value === "") continue;
    cleanExtra[key] = value;
  }

  const internalQuery: Record<string, string | string[]> = { ...cleanExtra };
  if (currentPathname === "/project/[di]" && extraQuery.di) {
    internalQuery.di = extraQuery.di;
  }

  if (view === "chat") {
    if (conversationId) internalQuery.conversation = conversationId;
  } else {
    internalQuery.view = view;
  }

  const href = { pathname: currentPathname, query: internalQuery };

  if (currentPathname !== "/") {
    return { href };
  }

  if (view === "library") {
    return { href, as: `/library${serializeQuery(cleanExtra)}` };
  }
  if (view === "projects") {
    return { href, as: `/projects${serializeQuery(cleanExtra)}` };
  }
  if (view === "schedules") {
    return { href, as: `/schedules${serializeQuery(cleanExtra)}` };
  }
  if (conversationId) {
    return {
      href,
      as: `/c/${encodeURIComponent(conversationId)}${serializeQuery(cleanExtra)}`,
    };
  }
  return { href, as: `/${serializeQuery(cleanExtra)}` };
}
