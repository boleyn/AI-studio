import { useState, useEffect, useMemo } from "react";
import { listSkills } from "../services/skills";

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
    let active = true;
    const tokenForSkills =
      (skillsProjectToken && skillsProjectToken.trim()) ||
      (token.startsWith("skill-studio:") ? "" : token);
    
    listSkills(tokenForSkills)
      .then((result) => {
        if (!active) return;
        const next = (result.skills || [])
          .filter((item) => item.isLoadable && typeof item.name === "string" && item.name.length > 0)
          .map((item) => ({
            name: item.name as string,
            description: item.description,
          }));
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
        setSkillOptions([]);
      });
      
    return () => {
      active = false;
    };
  }, [
    defaultSelectedSkill,
    isSkillsOpen,
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
