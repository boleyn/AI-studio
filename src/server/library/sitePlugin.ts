import type { AgentPlugin } from "@/agent/plugins/types";
import { getMongoDb } from "@server/db/mongo";

export function siteConnectionsPlugin(owner?: string, projectToken?: string): AgentPlugin {
  return {
    manifest: {
      id: "site-connections",
      version: "1.0.0",
      description: "Manage plugin connections for the current published site",
      defaultEnabled: true,
    },
    setup(context) {
      if (!owner || !projectToken) return;
      context.registerTool<{id: string}>({
        name: "ConnectSitePlugin",
        toolset: "site-connections",
        description: "Register Google Drive for the current published site when the owner asks to connect it. Visitors must authorize their own accounts.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: {type: "string", enum: ["google-drive"]} },
        },
        async handler(input, ctx) {
          if (ctx.isSubagent || input.id !== "google-drive") return {isError:true, content:"不支持此连接请求。"};
          const db = await getMongoDb();
          const publication = await db.collection("share_links").findOne(
            {ownerUserId:owner, projectToken, mode:"preview"}, {projection:{_id:1}},
          );
          if (!publication) return {isError:true, content:"请先发布当前项目的站点。"};
          const drive = await db.collection<{_id:string}>("library_drive_connections").findOne({_id:owner}, {projection:{_id:1}});
          if (!drive) return {isError:true, content:"请先在资料空间中连接 Google Drive。"};
          const id = input.id;
          await db.collection<{_id:string; owner:string; projectToken:string; id:string; name:string}>("site_plugins").updateOne(
            {_id:JSON.stringify([owner, projectToken, id])},
            {$set:{owner, projectToken, id, name:"Google Drive"}},
            {upsert:true},
          );
          return {content:"已在本站点的插件设置中登记 Google Drive。访客仍需单独授权。"};
        },
      });
    },
  };
}
