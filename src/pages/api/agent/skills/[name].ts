import { getRuntimeSkillByName, sampleSkillFiles } from "@server/agent/skills/registry";
import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

const getName = (req: NextApiRequest) => {
  const name = req.query.name;
  if (Array.isArray(name)) return name[0] || "";
  return typeof name === "string" ? name : "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const name = getName(req).trim();
  if (!name) {
    res.status(400).json({ error: "缺少 name 参数" });
    return;
  }

  const { skill, available } = await getRuntimeSkillByName(name);
  if (!skill) {
    res.status(404).json({
      error: `未找到 skill: ${name}`,
      available,
    });
    return;
  }

  const sampledFiles = await sampleSkillFiles(skill, 10);
  res.status(200).json({
    name: skill.name,
    description: skill.description,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    location: skill.location,
    relativeLocation: skill.relativeLocation,
    baseDir: skill.baseDir,
    body: skill.body,
    sampledFiles,
  });
}
