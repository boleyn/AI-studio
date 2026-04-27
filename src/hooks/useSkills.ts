import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useToast } from "@chakra-ui/react";

import { withAuthHeaders } from "@features/auth/client/authClient";
import type { SkillDetail, SkillListItem, SkillSourceType } from "@/types/skill";

type CreateSkillInput = {
  name?: string;
  description?: string;
  sourceType?: SkillSourceType;
  templateKey?: string;
  sourceSkillId?: string;
};

export function useSkills() {
  const router = useRouter();
  const toast = useToast();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);

  const loadSkills = useCallback(
    async (query?: string) => {
      try {
        setLoading(true);
        const suffix = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
        const response = await fetch(`/api/skills${suffix}`, {
          headers: withAuthHeaders(),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "获取技能列表失败");
        }
        const payload = await response.json();
        setSkills(Array.isArray(payload.skills) ? payload.skills : []);
        setTemplates(Array.isArray(payload.templates) ? payload.templates : []);
      } catch (error) {
        toast({
          title: "加载技能失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 2600,
        });
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const buildSkillEditorRoute = useCallback(
    (token: string) => {
      const params = new URLSearchParams({ skillId: token });
      const currentPath = typeof router.asPath === "string" ? router.asPath : "";
      if (currentPath.startsWith("/") && !currentPath.startsWith("/skills/create")) {
        params.set("returnTo", currentPath);
      }
      return `/skills/create?${params.toString()}`;
    },
    [router.asPath]
  );

  const createSkill = useCallback(
    async (input: CreateSkillInput) => {
      try {
        setCreating(true);
        const response = await fetch("/api/skills", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
          body: JSON.stringify(input),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "创建技能失败");
        }
        const skill: SkillDetail | undefined = payload.skill;
        await loadSkills();
        if (skill?.token) {
          await router.push(buildSkillEditorRoute(skill.token));
        }
        return skill || null;
      } catch (error) {
        toast({
          title: "创建失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 2600,
        });
        return null;
      } finally {
        setCreating(false);
      }
    },
    [buildSkillEditorRoute, loadSkills, router, toast]
  );

  const openSkill = useCallback(
    async (token: string) => {
      await router.push(buildSkillEditorRoute(token));
    },
    [buildSkillEditorRoute, router]
  );

  const updateSkill = useCallback(
    async (token: string, name: string, description?: string) => {
      try {
        const response = await fetch(`/api/skills/${encodeURIComponent(token)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
          body: JSON.stringify({
            name: name.trim() || undefined,
            description: description?.trim() || "",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "更新失败");
        }
        await loadSkills();
        toast({ title: "Skill 已更新", status: "success", duration: 1600 });
      } catch (error) {
        toast({
          title: "更新失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 2600,
        });
      }
    },
    [loadSkills, toast]
  );

  const deleteSkill = useCallback(
    async (token: string) => {
      try {
        const response = await fetch(`/api/skills/${encodeURIComponent(token)}`, {
          method: "DELETE",
          headers: withAuthHeaders(),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "删除失败");
        }
        await loadSkills();
        toast({ title: "Skill 已删除", status: "success", duration: 1600 });
      } catch (error) {
        toast({
          title: "删除失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 2600,
        });
      }
    },
    [loadSkills, toast]
  );

  const duplicateSkill = useCallback(
    async (token: string) => {
      try {
        const response = await fetch("/api/skills", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
          body: JSON.stringify({
            sourceSkillId: token,
            sourceType: "custom",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "复制失败");
        }
        const skill: SkillDetail | undefined = payload.skill;
        await loadSkills();
        toast({ title: "Skill 已复制", status: "success", duration: 1600 });
        return skill || null;
      } catch (error) {
        toast({
          title: "复制失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 2600,
        });
        return null;
      }
    },
    [loadSkills, toast]
  );

  const templateOptions = useMemo(() => templates, [templates]);

  return {
    skills,
    loading,
    creating,
    loadSkills,
    createSkill,
    openSkill,
    updateSkill,
    deleteSkill,
    duplicateSkill,
    templateOptions,
  };
}
