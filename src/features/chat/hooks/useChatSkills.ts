import { useEffect, useMemo, useState } from "react";
import { listSkills } from "../services/skills";

const inferSkillOptionsFromFiles = (fileOptions?: string[]) =>
  Array.from(
    new Set(
      (fileOptions || [])
        .map((item) => item.replace(/\\/g, "/"))
        .map((item) => {
          const match =
            item.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i) ||
            item.match(/(?:^|\/)\.aistudio\/skills\/([^/]+)\/SKILL\.md$/i);
          return match?.[1]?.trim() || "";
        })
        .filter(Boolean)
    )
  )
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name }));

const mergeSkillOptions = (
  inferred: Array<{ name: string; description?: string }>,
  remote: Array<{ name: string; description?: string }>
) => {
  const merged = new Map<string, { name: string; description?: string }>();
  for (const item of inferred) {
    if (!item.name) continue;
    merged.set(item.name, item);
  }
  for (const item of remote) {
    if (!item.name) continue;
    merged.set(item.name, item);
  }
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export const useChatSkills = ({
  token,
  defaultSelectedSkill,
  hideSkillsManager,
  openSkillsSignal,
  skillsProjectToken,
  fileOptions,
}: {
  token: string;
  defaultSelectedSkill?: string;
  hideSkillsManager?: boolean;
  openSkillsSignal?: number;
  skillsProjectToken?: string;
  fileOptions?: string[];
}) => {
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    defaultSelectedSkill ? [defaultSelectedSkill] : []
  );
  const [skillOptions, setSkillOptions] = useState<Array<{ name: string; description?: string }>>([]);

  const skillListRefreshKey = useMemo(
    () =>
      (fileOptions || [])
        .filter((item) => /\/SKILL\.md$/i.test(item))
        .sort((a, b) => a.localeCompare(b))
        .join("|"),
    [fileOptions]
  );

  useEffect(() => {
    if (hideSkillsManager) return;
    if (!openSkillsSignal) return;
    setIsSkillsOpen(true);
  }, [hideSkillsManager, openSkillsSignal]);

  useEffect(() => {
    const inferredSkillOptions = inferSkillOptionsFromFiles(fileOptions);
    setSkillOptions((prev) => mergeSkillOptions(inferredSkillOptions, prev));
  }, [fileOptions]);

  useEffect(() => {
    if (selectedSkills.length === 0) return;
    setSkillOptions((prev) =>
      mergeSkillOptions(
        selectedSkills.filter(Boolean).map((name) => ({ name })),
        prev
      )
    );
  }, [selectedSkills]);

  useEffect(() => {
    let active = true;
    const builtinToken = token.startsWith("skill-studio:") ? "" : token;
    const projectToken = (skillsProjectToken && skillsProjectToken.trim()) || "";
    const inferredSkillOptions = inferSkillOptionsFromFiles(fileOptions);
    const toVisible = (result: { skills?: Array<{ isLoadable?: boolean; name?: string; description?: string }> }) =>
      (result.skills || [])
        .filter((item) => typeof item.name === "string" && item.name.length > 0)
        .map((item) => ({
          name: item.name as string,
          description:
            item.isLoadable === false
              ? `${item.description || "技能可见，但当前环境标记为不可加载"}`
              : item.description,
        }));

    Promise.allSettled([
      listSkills(builtinToken).then(toVisible),
      projectToken ? listSkills(projectToken).then(toVisible) : Promise.resolve([] as Array<{ name: string; description?: string }>),
    ])
      .then((results) => {
        if (!active) return;
        const builtinSkills = results[0].status === "fulfilled" ? results[0].value : [];
        const projectSkills =
          results[1] && results[1].status === "fulfilled" ? results[1].value : [];
        const remote = [...builtinSkills, ...projectSkills];
        const next = mergeSkillOptions(inferredSkillOptions, remote);
        setSkillOptions(next);

        setSelectedSkills((prev) => {
          if (prev.length > 0) return prev;
          if (!defaultSelectedSkill) return prev;
          if (!next.some((item) => item.name === defaultSelectedSkill)) return prev;
          return [defaultSelectedSkill];
        });
      })
      .catch(() => {
        if (!active) return;
        setSkillOptions(mergeSkillOptions(inferredSkillOptions, []));
      });
      
    return () => {
      active = false;
    };
  }, [
    defaultSelectedSkill,
    skillsProjectToken,
    token,
    skillListRefreshKey,
  ]);

  return {
    isSkillsOpen,
    setIsSkillsOpen,
    selectedSkills,
    setSelectedSkills,
    skillOptions,
  };
};
