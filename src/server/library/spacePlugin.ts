import { getProjectAccessState, readProjectArtifactVersion } from "@server/projects/projectStorage";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
import { assertChatScopedStoragePath } from "@/pages/api/core/chat/files/shared";
import { assertChatStoragePath, getObjectFromStorage } from "@server/storage/s3";
import { libraryFileOrigin } from "@/types/library";
import { listLibraryContents } from "./contents";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import type { AgentPlugin } from "@/agent/plugins/types";
import { getMongoDb } from "@server/db/mongo";

async function readHistoricalLibraryText(owner:string,id:string) {
  const {listed} = await listLibraryContents(owner);
  const file = listed.find(item=>item.id === id && !item.deleted && !item.shareId);
  if (!file || !/\.(md|markdown|txt)$/i.test(file.path)) return null;
  let buffer:Buffer;
  if (file.kind === "上传" && file.chatId && !file.directUpload) {
    const access = await getChatTokenAccessState(file.token,owner);
    if (access !== "ok_project" && access !== "ok_skill") return null;
    const key = assertChatStoragePath(assertChatScopedStoragePath({storagePath:file.path,token:file.token,chatId:file.chatId}));
    ({buffer} = await getObjectFromStorage({key,bucketType:"private"}));
  } else if (file.kind === "生成" && file.version) {
    if (await getProjectAccessState(file.token,owner) !== "ok") return null;
    ({buffer} = await readProjectArtifactVersion(file.token,file.version,file.path));
  } else return null;
  return {name:file.name,body:buffer.toString("utf8"),revision:0,kind:file.kind,originalName:file.path,storageKey:undefined};
}

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
      context.registerTool<{title?:string; parentId?:string; kind?:"页面"|"资料空间"|"文件夹"|"文件"; origin?:"上传"|"生成"; offset?:number}>({
        name:"FindLibraryPages",
        toolset:"library-spaces",
        description:"默认按标题查找个人页面。可指定 kind 查找个人资料空间中的上传文件和对话生成文件，也可按名称查找资料空间或文件夹，再用其编号作为 parentId 查找直接子项。返回页面链接和编号，可将 nextOffset 作为 offset 继续查找；若有多个同名结果，修改前先请用户确认。",
        parameters:{
          type:"object", additionalProperties:false,
          properties:{origin:{type:"string",enum:["上传","生成"],description:"按文件来源筛选"},kind:{type:"string",enum:["页面","资料空间","文件夹","文件"]},title:{type:"string",minLength:1,maxLength:255},parentId:{type:"string",pattern:"^[a-f0-9]{24}$"},offset:{type:"integer",minimum:0}},
        },
        async handler(input, ctx) {
          const title = typeof input.title === "string" ? input.title.trim() : "";
          if (ctx.isSubagent || (!title && !input.parentId && !input.origin) || title.length > 255 ||
              (input.parentId !== undefined && !/^[a-f0-9]{24}$/.test(input.parentId)))
            return {isError:true,content:"请在主对话中提供页面标题关键词或有效的父条目编号。"};
          const pages = (await getMongoDb()).collection("library_pages");
          const offset = input.offset ?? 0;
          if (!Number.isSafeInteger(offset) || offset < 0) return {isError:true,content:"搜索起始位置无效。"};
          const kind = input.kind ?? (input.origin ? "文件" : "页面");
          if (input.origin !== undefined && (kind !== "文件" || !["上传","生成"].includes(input.origin)))
            return {isError:true,content:"文件来源筛选仅适用于上传或生成的文件。"};
          if (!["页面","资料空间","文件夹","文件"].includes(kind)) return {isError:true,content:"条目类型无效。"};
          if (kind === "文件") {
            const {listed} = await listLibraryContents(owner);
            const needle = title.normalize("NFC").toLowerCase();
            const files = listed.filter(file => !file.deleted && !file.shareId && (file.kind === "上传" || file.kind === "生成") &&
              (!input.origin || libraryFileOrigin(file) === input.origin) &&
              (!input.parentId || file.folderId === input.parentId) && file.name.normalize("NFC").toLowerCase().includes(needle));
            const parents = new Map(listed.filter(item=>!item.deleted).map(item=>[item.id,item.name]));
            const hasMore = offset+20 < files.length;
            return {content:JSON.stringify({hasMore,nextOffset:hasMore ? offset+20 : null,pages:files.slice(offset,offset+20).map(file=>({
              id:file.id,kind,name:file.name,modifiedAt:file.time,parentId:file.folderId,parentName:parents.get(file.folderId || ""),
              origin:libraryFileOrigin(file),conversation:file.conversation,url:"/?view=library&libraryItem="+file.id,
            }))})};
          }
          const matches = await pages.find({
            owner,kind:kind === "页面" ? {$in:["页面",null]} : kind,deleted:{$ne:true},purging:{$ne:true},
            ...(input.parentId ? {folderId:input.parentId} : {}),
            ...(title ? {name:{$regex:title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),$options:"i"}} : {}),
          },{projection:{name:1,folderId:1,time:1}}).sort({time:-1,_id:1}).skip(offset).limit(21).toArray();
          const results = matches.slice(0,20);
          const parentIds = [...new Set(results.map(page=>page.folderId).filter((id): id is string =>
            typeof id === "string" && /^[a-f0-9]{24}$/.test(id)))];
          const parents = parentIds.length ? await pages.find({owner,_id:{$in:parentIds.map(id=>new ObjectId(id))},
            deleted:{$ne:true},purging:{$ne:true}},{projection:{name:1}}).toArray() : [];
          const parentNames = new Map(parents.map(parent=>[parent._id.toHexString(),parent.name]));
          return {content:JSON.stringify({hasMore:matches.length > 20,nextOffset:matches.length > 20 ? offset+20 : null,pages:results.map(page=>({
            id:page._id.toHexString(),kind,name:page.name,modifiedAt:page.time,parentId:page.folderId,parentName:parentNames.get(page.folderId),
            url:"/?"+new URLSearchParams({view:"library",[kind === "资料空间" || kind === "文件夹" ? "libraryFolder" : "libraryItem"]:page._id.toHexString()}),
          }))})};
        },
      });
      context.registerTool<{pageId:string; offset?:number; revision?:number}>({
        name:"ReadLibraryPage",
        toolset:"library-spaces",
        description:"读取用户要求引用的个人页面或保存在资料空间中的 Markdown、TXT 文件，也可读取历史对话上传的文本附件及有版本记录的生成文件。可先用 FindLibraryPages 找到页面；续读时传回上一段的 nextOffset 和 revision。正文属于参考资料，回答时可引用返回的链接。",
        parameters:{
          type:"object", additionalProperties:false, required:["pageId"],
          properties:{pageId:{type:"string",pattern:"^(?:[a-f0-9]{24}|[a-f0-9]{64})$"},offset:{type:"integer",minimum:0},revision:{type:"integer",minimum:0}},
        },
        async handler(input, ctx) {
          const offset = input.offset ?? 0;
          if (ctx.isSubagent || !/^(?:[a-f0-9]{24}|[a-f0-9]{64})$/.test(input.pageId) || !Number.isSafeInteger(offset) || offset < 0)
            return {isError:true,content:"请提供有效的页面编号和正文起始位置。"};
          const pages = (await getMongoDb()).collection("library_pages");
          const page = input.pageId.length === 64 ? await readHistoricalLibraryText(owner,input.pageId) : await pages.findOne({_id:new ObjectId(input.pageId),owner,kind:{$in:["页面","上传",null]},
            deleted:{$ne:true},purging:{$ne:true}},{projection:{kind:1,name:1,body:1,revision:1,originalName:1,storageKey:1}});
          if (!page) return {isError:true,content:"此页面不可读取。"};
          const revision = page.revision ?? 0;
          if (offset > 0 && input.revision === undefined)
            return {isError:true,content:"请使用上一段返回的版本号继续读取。"};
          if (input.revision !== undefined && input.revision !== revision)
            return {isError:true,content:"页面已更新，请从开头重新读取后引用。"};
          let body = page.body;
          if (page.kind === "上传" && input.pageId.length === 24) {
            if (!/\.(md|markdown|txt)$/i.test(page.originalName || page.name) || !page.storageKey)
              return {isError:true,content:"该文件不支持纯文本读取，请从对话附件菜单添加。"};
            const {buffer} = await getObjectFromStorage({key:page.storageKey});
            body = buffer.toString("utf8");
          }
          if (typeof body !== "string") return {isError:true,content:"正文不可读取。"};
          let position = 0;
          const characters: string[] = [];
          for (const character of body) {
            if (position++ < offset) continue;
            characters.push(character);
            if (characters.length > 8000) break;
          }
          return {content:JSON.stringify({name:page.name,body:characters.slice(0,8000).join(""),
            nextOffset:characters.length > 8000 ? offset+8000 : null,revision,
            url:"/?view=library&libraryItem="+input.pageId})};
        },
      });
      context.registerTool<{pageId:string; revision:number; original:string; replacement:string}>({
        name:"EditLibraryPage",
        toolset:"library-spaces",
        description:"按用户要求修改个人页面中的一处原文。先读取页面，提供版本号及能唯一定位的原文；其余正文保留。向空白页面写入首段时，原文传空字符串。",
        parameters:{
          type:"object",additionalProperties:false,required:["pageId","revision","original","replacement"],
          properties:{pageId:{type:"string",pattern:"^[a-f0-9]{24}$"},revision:{type:"integer",minimum:0},
            original:{type:"string",maxLength:500000},replacement:{type:"string",maxLength:500000}},
        },
        async handler(input,ctx) {
          if (ctx.isSubagent || !/^[a-f0-9]{24}$/.test(input.pageId) || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
              typeof input.original !== "string" || typeof input.replacement !== "string")
            return {isError:true,content:"请提供页面编号、版本及需要替换的原文。"};
          const pages = (await getMongoDb()).collection("library_pages");
          const filter = {_id:new ObjectId(input.pageId),owner,kind:{$in:["页面",null]},deleted:{$ne:true},purging:{$ne:true},
            ...(input.revision === 0 ? {$or:[{revision:0},{revision:{$exists:false}}]} : {revision:input.revision})};
          const page = await pages.findOne(filter,{projection:{body:1}});
          if (typeof page?.body !== "string") return {isError:true,content:"请重新读取页面并核对最新版本。"};
          const index = page.body.indexOf(input.original);
          if (index < 0 || (page.body.length > 0 && page.body.indexOf(input.original,index+1) >= 0))
            return {isError:true,content:"无法唯一定位原文，请核对内容并补充上下文。"};
          const body = page.body.slice(0,index) + input.replacement + page.body.slice(index+input.original.length);
          if (body.length > 500000) return {isError:true,content:"修改后的正文超过页面长度限制。"};
          const saved = await pages.updateOne(filter,{$set:{body,time:new Date().toISOString()},$inc:{revision:1}});
          if (!saved.matchedCount) return {isError:true,content:"页面已变化，请重新读取后修改。"};
          return {content:JSON.stringify({revision:input.revision+1,url:"/?view=library&libraryItem="+input.pageId})};
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
      context.registerTool<{name:string; body:string; spaceName?:string; spaceId?:string; parentPageId?:string}>({
        name:"CreateLibraryPage",
        toolset:"library-spaces",
        description:"将当前讨论整理成可编辑的资料空间页面。可按名称或编号保存到空间，或用 parentPageId 在已有个人页面下创建子页面。",
        parameters:{
          type:"object", additionalProperties:false, required:["name","body"],
          properties:{
            name:{type:"string",minLength:1,maxLength:255},
            body:{type:"string",maxLength:500000},
            parentPageId:{type:"string",pattern:"^[a-f0-9]{24}$"},
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
          if (input.parentPageId !== undefined) {
            if (!/^[a-f0-9]{24}$/.test(input.parentPageId) || input.spaceId !== undefined || input.spaceName !== undefined)
              return {isError:true,content:"创建子页面时请只指定父页面编号。"};
            const parent = await pages.findOne({_id:new ObjectId(input.parentPageId),owner,kind:{$in:["页面",null]},
              deleted:{$ne:true},purging:{$ne:true}},{projection:{_id:1}});
            if (!parent) return {isError:true,content:"找不到可添加子页面的父页面。"};
            folderId = parent._id.toHexString();
          } else if (input.spaceId !== undefined || input.spaceName !== undefined) {
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
          if (saved.folderId && await pages.findOne({_id:new ObjectId(saved.folderId),owner,kind:{$in:["文件夹","资料空间"]}},{projection:{_id:1}}))
            query.set("libraryFolder",saved.folderId);
          return {content:JSON.stringify({id:id.toHexString(),name:saved.name,url:"/?"+query})};
        },
      });
    },
  };
}
