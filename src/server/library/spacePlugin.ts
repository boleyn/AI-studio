import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import type { AgentPlugin } from "@/agent/plugins/types";
import { getMongoDb } from "@server/db/mongo";

export function librarySpacePlugin(owner?: string, token?: string, chatId?: string): AgentPlugin {
  return {
    manifest: {id:"library-spaces", version:"1.0.0", description:"Create spaces from chats", defaultEnabled:true},
    setup(context) {
      if (!owner || !token || !chatId) return;
      context.registerTool<{name:string}>({
        name:"CreateLibrarySpace",
        toolset:"library-spaces",
        description:"按用户指定的名称创建个人资料空间。Create a private space in the current user's library and return its link.",
        parameters:{
          type:"object", additionalProperties:false, required:["name"],
          properties:{name:{type:"string",minLength:1,maxLength:255}},
        },
        async handler(input, ctx) {
          const name = typeof input.name === "string" ? input.name.trim() : "";
          if (!name || name.length > 255 || ctx.isSubagent) return {isError:true,content:"请在主对话中提供有效的资料空间名称。"};
          const identity = JSON.stringify(["library-space",owner,token,chatId,ctx.toolUseId]);
          const id = new ObjectId(createHash("sha256").update(identity).digest("hex").slice(0,24));
          const pages = (await getMongoDb()).collection("library_pages");
          await pages.updateOne({_id:id,owner}, {$setOnInsert:{
            kind:"资料空间", name, body:"", folderId:null, time:new Date().toISOString(),
          }}, {upsert:true});
          return {content:JSON.stringify({id:id.toHexString(),name,url:"/?view=library&libraryFolder="+id.toHexString()})};
        },
      });
    },
  };
}
