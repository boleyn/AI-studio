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
      context.registerTool<{pageId:string; name:string}>({
        name:"RenameLibraryPage",
        toolset:"library-spaces",
        description:"按用户要求重命名自己的资料空间页面。使用页面链接中的 libraryItem 编号。",
        parameters:{
          type:"object", additionalProperties:false, required:["pageId","name"],
          properties:{pageId:{type:"string",pattern:"^[a-f0-9]{24}$"},name:{type:"string",minLength:1,maxLength:255}},
        },
        async handler(input, ctx) {
          const name = typeof input.name === "string" ? input.name.trim() : "";
          if (ctx.isSubagent || !name || name.length > 255 || !/^[a-f0-9]{24}$/.test(input.pageId))
            return {isError:true,content:"请在主对话中提供有效的页面编号和新名称。"};
          const pages = (await getMongoDb()).collection("library_pages");
          const filter = {_id:new ObjectId(input.pageId),owner,kind:{$in:["页面",null]},deleted:{$ne:true},purging:{$ne:true}};
          const result = await pages.updateOne({...filter,name:{$ne:name}},{
            $set:{name,time:new Date().toISOString()},$inc:{revision:1},
          });
          if (!result.matchedCount && !await pages.findOne({...filter,name},{projection:{_id:1}}))
            return {isError:true,content:"找不到可重命名的页面。"};
          return {content:JSON.stringify({name,url:"/?view=library&libraryItem="+input.pageId})};
        },
      });
      context.registerTool<{name:string; body:string; spaceName?:string; spaceId?:string}>({
        name:"CreateLibraryPage",
        toolset:"library-spaces",
        description:"将当前讨论整理成可编辑的资料空间页面。Save a Markdown page in the user's library, optionally in a named space or one identified by its ID.",
        parameters:{
          type:"object", additionalProperties:false, required:["name","body"],
          properties:{
            name:{type:"string",minLength:1,maxLength:255},
            body:{type:"string",maxLength:500000},
            spaceName:{type:"string",minLength:1,maxLength:255},
            spaceId:{type:"string",pattern:"^[a-f0-9]{24}$"},
          },
        },
        async handler(input, ctx) {
          const name = typeof input.name === "string" ? input.name.trim() : "";
          if (ctx.isSubagent || !name || name.length > 255 || typeof input.body !== "string" || input.body.length > 500000)
            return {isError:true,content:"请在主对话中提供有效的页面名称和正文。"};
          const pages = (await getMongoDb()).collection("library_pages");
          let folderId: string | null = null;
          if (input.spaceId !== undefined || input.spaceName !== undefined) {
            if (input.spaceId !== undefined && !/^[a-f0-9]{24}$/.test(input.spaceId))
              return {isError:true,content:"资料空间编号无效。"};
            const spaces = await pages.find({owner,kind:"资料空间",deleted:{$ne:true},purging:{$ne:true},
              ...(input.spaceId ? {_id:new ObjectId(input.spaceId)} : {}),
              ...(input.spaceName !== undefined ? {name:input.spaceName.trim()} : {}),
            },{projection:{_id:1}}).limit(2).toArray();
            if (spaces.length !== 1) return {isError:true,content:spaces.length ? "存在同名空间，请使用目标空间链接中的编号。" : "找不到指定的资料空间。"};
            folderId = spaces[0]._id.toHexString();
          }
          const identity = JSON.stringify(["library-page",owner,token,chatId,ctx.toolUseId]);
          const id = new ObjectId(createHash("sha256").update(identity).digest("hex").slice(0,24));
          const saved = await pages.findOneAndUpdate({_id:id,owner},{$setOnInsert:{
            kind:"页面", name, body:input.body, folderId, sourceChat:{token,chatId}, time:new Date().toISOString(),
          }},{upsert:true,returnDocument:"after",projection:{name:1,folderId:1,deleted:1,purging:1}});
          if (!saved || saved.deleted || saved.purging) return {isError:true,content:"此页面已不可用。"};
          const query = new URLSearchParams({view:"library",libraryItem:id.toHexString()});
          if (saved.folderId) query.set("libraryFolder",saved.folderId);
          return {content:JSON.stringify({id:id.toHexString(),name:saved.name,url:"/?"+query})};
        },
      });
    },
  };
}
