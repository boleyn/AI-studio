import { createHash } from "node:crypto";
import { getMongoDb } from "@server/db/mongo";
import { deleteStorageObjects, getObjectFromStorage, uploadObjectToStorage } from "@server/storage/s3";

export type ArtifactShareMember = { userId: string; username: string; canEdit?: boolean; invitedAt?: string };

type ArtifactShare = {
  _id: string;
  libraryItemId?: string;
  livePage?: boolean;
  fileOrigin?: "上传" | "生成";
  projectToken: string;
  ownerId: string;
  ownerName: string;
  filename: string;
  members: ArtifactShareMember[];
};

const collection = async () => (await getMongoDb()).collection<ArtifactShare>("artifact_shares");
const objectKey = (id: string) => `artifact-shares/${id}/snapshot`;

export async function createArtifactShare(input: {
  libraryItemId?: string;
  livePage?: boolean;
  fileOrigin?: "上传" | "生成";
  projectToken: string;
  ownerId: string;
  ownerName: string;
  path: string;
  bytes: Buffer;
}) {
  const id = input.livePage
    ? createHash("sha256").update(JSON.stringify(["library-page", input.ownerId, input.libraryItemId])).digest("hex")
    : createHash("sha256").update(JSON.stringify([input.libraryItemId || input.projectToken, input.ownerId, input.path]))
    .update(input.bytes).digest("hex");
  const shares = await collection();
  const existing = await shares.findOne({ _id: id });
  if (existing && !input.livePage) {
    if (input.fileOrigin && !existing.fileOrigin) await shares.updateOne({_id:id},{$set:{fileOrigin:input.fileOrigin}});
    return existing;
  }
  if (!input.livePage) await uploadObjectToStorage({
    key: objectKey(id),
    body: input.bytes,
    contentType: "application/octet-stream",
    bucketType: "private",
  });
  const share = {
    _id: id,
    projectToken: input.projectToken,
    ...(input.fileOrigin ? {fileOrigin:input.fileOrigin} : {}),
    ...(input.livePage ? {livePage:true} : {}),
    ...(input.libraryItemId ? {libraryItemId:input.libraryItemId} : {}),
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    filename: input.path.split("/").pop() || "file",
    members: [],
  };
  const {filename, ...identity} = share;
  return shares.findOneAndUpdate({ _id: id }, { $setOnInsert: identity, $set: {filename} }, { upsert: true, returnDocument: "after" });
}

export async function getArtifactShare(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  return (await collection()).findOne({ _id: id });
}

export async function updateArtifactShareMember(id: string, ownerId: string, member: ArtifactShareMember, action: "invite" | "edit" | "remove") {
  const shares = await collection();
  const filter = { _id: id, ownerId };
  if (action === "remove") {
    return shares.findOneAndUpdate(filter, { $pull: { members: { userId: member.userId } } }, { returnDocument: "after" });
  }
  if (action === "invite") {
    await shares.updateOne({ ...filter, "members.userId": { $ne: member.userId } }, { $push: { members: {...member, invitedAt:new Date().toISOString()} } });
  }
  if (member.canEdit !== undefined) {
    await shares.updateOne({...filter,"members.userId":member.userId}, {$set:{"members.$.canEdit":member.canEdit}});
  }
  return shares.findOne(filter);
}

export async function readArtifactShareSnapshot(id: string) {
  return getObjectFromStorage({ key: objectKey(id), bucketType: "private" });
}


export async function deleteProjectArtifactShares(projectToken: string) {
  const shares = await collection();
  const records = await shares.find({ projectToken }, { projection: { _id: 1 } }).toArray();
  if (!records.length) return;
  const ids = records.map(({ _id }) => _id);
  await deleteStorageObjects({ keys: ids.map(objectKey), bucketType: "private" });
  await shares.deleteMany({ projectToken, _id: { $in: ids } });
}

export async function listReceivedArtifactShares(userId:string) {
  return (await collection()).find({"members.userId":userId}).project<Pick<ArtifactShare,"_id"|"ownerName"|"filename"|"ownerId"|"projectToken"|"libraryItemId"|"livePage"|"fileOrigin"|"members">>(
    {ownerName:1,filename:1,ownerId:1,projectToken:1,libraryItemId:1,livePage:1,fileOrigin:1,members:{$elemMatch:{userId}}}).toArray();
}
