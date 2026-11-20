import type { AgentPlugin } from "@/agent/plugins/types";
import { sitePreviewPath } from "@/types/library";
import { getMongoDb } from "@server/db/mongo";
import { getSiteSettings, siteLibraryId } from "@server/library/sites";
import { getProject } from "@server/projects/projectStorage";
import { createShareLink } from "@server/shares/shareStorage";
import {
  buildStaticSite,
  ensureStaticSiteBuilt,
  removeStaticSiteBuild,
} from "@server/shares/staticSiteBuilder";

type PreviewLinkDoc = {
  shareId: string;
  createdAt?: string;
  updatedAt?: string;
};

async function findLatestPreviewLink(owner: string, projectToken: string): Promise<PreviewLinkDoc | null> {
  const db = await getMongoDb();
  return db
    .collection<PreviewLinkDoc>("share_links")
    .findOne(
      { ownerUserId: owner, projectToken, mode: "preview" },
      { sort: { createdAt: -1, _id: -1 }, projection: { shareId: 1, createdAt: 1, updatedAt: 1 } },
    );
}

export function siteConnectionsPlugin(owner?: string, projectToken?: string): AgentPlugin {
  return {
    manifest: {
      id: "site-connections",
      version: "1.0.0",
      description: "Inspect published static site status, build & publish sites, and manage site plugin connections",
      defaultEnabled: true,
    },
    setup(context) {
      if (!owner || !projectToken) return;

      context.registerTool<Record<string, never>>({
        name: "get_site_status",
        toolset: "site",
        readOnly: true,
        description:
          "查询当前项目的发布站点状态与静态构建状态（是否已发布、访问链接、访问权限、静态构建结果与报错）。" +
          "Inspect the current project's published static site status, share URL, access setting, and static build result.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        async handler(_input, ctx) {
          if (ctx.isSubagent) return { isError: true, content: "子代理无法查询当前用户站点状态。" };
          const project = await getProject(projectToken);
          if (!project || project.userId !== owner) {
            return { isError: true, content: "当前项目不存在或无权访问。" };
          }
          const [publication, settings] = await Promise.all([
            findLatestPreviewLink(owner, projectToken),
            getSiteSettings(owner, projectToken),
          ]);

          const buildResult = publication
            ? await ensureStaticSiteBuilt(publication.shareId, project)
            : null;

          return {
            content: JSON.stringify({
              ok: true,
              runtime: "static",
              projectName: settings?.name || project.name,
              template: project.template,
              published: Boolean(publication),
              shareId: publication?.shareId ?? null,
              path: publication ? sitePreviewPath(publication.shareId, settings?.siteSlug) : null,
              staticEntryUrl: publication ? `/api/sites/${publication.shareId}/index.html` : null,
              access: settings?.restricted ? "restricted" : "public",
              publishedAt: publication?.createdAt ?? null,
              projectUpdatedAt: project.updatedAt,
              build: buildResult
                ? {
                    status: buildResult.status,
                    mode: buildResult.mode,
                    entryFile: buildResult.entryFile,
                    assetCount: buildResult.assetCount,
                    builtAt: buildResult.builtAt,
                    errors: buildResult.errors.slice(-5),
                  }
                : {
                    status: "not_built",
                    mode: null,
                    entryFile: null,
                    assetCount: 0,
                    builtAt: null,
                    errors: [],
                  },
              note: publication
                ? "Published sites are statically built (esbuild / static HTML) and hosted directly by this platform (no persistent backend server process, no external Sandpack dependency). Saved workspace edits automatically trigger a rebuild on visit or publish."
                : "This project is not published yet. Call publish_site to build and publish it as a hosted static site.",
            }),
          };
        },
      });

      context.registerTool<{ force?: boolean }>({
        name: "publish_site",
        toolset: "site",
        description:
          "将当前项目静态构建并发布为平台托管站点（HTML/JS/CSS 静态产物），返回访问路径；若已发布则重建最新产物并复用现有链接。" +
          "Build and publish the current project as a platform-hosted static site and return its share path.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            force: {
              type: "boolean",
              description: "Set true to return the share link even if the static build reports errors. Defaults to false.",
            },
          },
        },
        async handler(input, ctx) {
          if (ctx.isSubagent) return { isError: true, content: "子代理无法发布站点。" };
          const project = await getProject(projectToken);
          if (!project || project.userId !== owner) {
            return { isError: true, content: "当前项目不存在或无权发布。" };
          }
          const hasRealFiles = Object.keys(project.files || {}).some((filePath) => filePath !== "/package.json");
          if (!hasRealFiles) {
            return { isError: true, content: "当前项目还没有可发布的页面代码文件，请先创建前端文件后再发布。" };
          }

          const [existing, settings] = await Promise.all([
            findLatestPreviewLink(owner, projectToken),
            getSiteSettings(owner, projectToken),
          ]);

          const shareLink =
            existing ||
            (await createShareLink({
              projectToken,
              mode: "preview",
              ownerUserId: owner,
            }));

          const build = await buildStaticSite(shareLink.shareId, project);
          if (!build.ok && !input.force) {
            return {
              isError: true,
              content: JSON.stringify({
                ok: false,
                runtime: "static",
                shareId: shareLink.shareId,
                path: sitePreviewPath(shareLink.shareId, settings?.siteSlug),
                error: "站点静态构建失败，请先修复以下构建错误后再重新发布。",
                buildErrors: build.errors.slice(-5),
              }),
            };
          }

          return {
            content: JSON.stringify({
              ok: build.ok,
              runtime: "static",
              alreadyPublished: Boolean(existing),
              shareId: shareLink.shareId,
              path: sitePreviewPath(shareLink.shareId, settings?.siteSlug),
              staticEntryUrl: `/api/sites/${shareLink.shareId}/index.html`,
              access: settings?.restricted ? "restricted" : "public",
              build: {
                status: build.status,
                mode: build.mode,
                entryFile: build.entryFile,
                assetCount: build.assetCount,
                builtAt: build.builtAt,
                errors: build.errors.slice(-5),
              },
              note: existing
                ? "已重新构建静态产物并更新至现有站点链接。"
                : "已完成静态构建并发布站点，访问链接即可直接打开静态托管页面。",
            }),
          };
        },
      });

      context.registerTool<Record<string, never>>({
        name: "unpublish_site",
        toolset: "site",
        description:
          "取消发布当前项目的站点：删除分享链接、自定义短链绑定、域名绑定与静态构建产物（保留项目源码文件）。" +
          "Unpublish the current project's published site, revoking its preview link and removing hosted static assets while keeping workspace files intact.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        async handler(_input, ctx) {
          if (ctx.isSubagent) return { isError: true, content: "子代理无法取消发布站点。" };
          const project = await getProject(projectToken);
          if (!project || project.userId !== owner) {
            return { isError: true, content: "当前项目不存在或无权操作。" };
          }

          const db = await getMongoDb();
          const links = db.collection("share_links");
          const publications = { projectToken, ownerUserId: owner, mode: "preview" };
          const shareIds = (await links.distinct("shareId", publications)).filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );

          if (shareIds.length === 0) {
            return {
              content: JSON.stringify({
                ok: true,
                unpublished: false,
                removedShareIds: [],
                note: "当前项目尚未发布站点，无需取消发布。",
              }),
            };
          }

          await db.collection<{ _id: string; owner: string }>("library_file_settings").updateOne(
            { _id: owner + "/" + siteLibraryId(projectToken), owner },
            { $unset: { siteSlug: "", siteProjectToken: "", siteShareId: "" } },
          );
          await db.collection("site_domains").deleteMany({ shareId: { $in: shareIds } });
          await links.deleteMany({ ...publications, shareId: { $in: shareIds } });
          await Promise.all(shareIds.map((id) => removeStaticSiteBuild(id)));

          return {
            content: JSON.stringify({
              ok: true,
              unpublished: true,
              removedShareIds: shareIds,
              note: "已取消发布当前站点，原有预览链接已失效，托管的静态产物已清理（项目源码保留不变）。",
            }),
          };
        },
      });

      context.registerTool<{ id: string }>({
        name: "ConnectSitePlugin",
        toolset: "site-connections",
        description:
          "站点插件：在站点所有者要求添加或连接 Google Drive 时，为当前已发布的站点登记插件。Register a site plugin connection. Visitor authorization is separate.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", enum: ["google-drive"] } },
        },
        async handler(input, ctx) {
          if (ctx.isSubagent || input.id !== "google-drive") return { isError: true, content: "不支持此连接请求。" };
          const db = await getMongoDb();
          const publication = await db
            .collection("share_links")
            .findOne({ ownerUserId: owner, projectToken, mode: "preview" }, { projection: { _id: 1 } });
          if (!publication) return { isError: true, content: "请先发布当前项目的站点。" };
          const drive = await db
            .collection<{ _id: string }>("library_drive_connections")
            .findOne({ _id: owner }, { projection: { _id: 1 } });
          if (!drive) return { isError: true, content: "请先在资料空间中连接 Google Drive。" };
          const id = input.id;
          await db
            .collection<{ _id: string; owner: string; projectToken: string; id: string; name: string }>("site_plugins")
            .updateOne(
              { _id: JSON.stringify([owner, projectToken, id]) },
              { $set: { owner, projectToken, id, name: "Google Drive" } },
              { upsert: true },
            );
          return { content: "已在本站点的插件设置中登记 Google Drive。访客仍需单独授权。" };
        },
      });
    },
  };
}
