import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useToast } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type { ProjectListItem } from "../types/project";

export function useProjects() {
  const router = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/projects", { headers: withAuthHeaders() });
      if (!response.ok) throw new Error("获取项目列表失败");
      const data = await response.json();
      setProjects(data);
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "未知错误",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const createProject = useCallback(
    async (name: string) => {
      try {
        setCreating(true);
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...withAuthHeaders() },
          body: JSON.stringify({ name: name.trim() }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "创建项目失败");
        }
        const project = await response.json();
        router.push(`/project/${project.token}`);
      } catch (error) {
        toast({
          title: "创建失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      } finally {
        setCreating(false);
      }
    },
    [router, toast]
  );

  const openProject = useCallback(
    (token: string) => {
      router.push(`/project/${token}`);
    },
    [router]
  );

  const renameProject = useCallback(
    async (token: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const response = await fetch(`/api/code?token=${encodeURIComponent(token)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...withAuthHeaders() },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "重命名失败");
        }
        await loadProjects();
        toast({ title: "已修改项目名称", status: "success", duration: 2000 });
      } catch (error) {
        toast({
          title: "重命名失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
    },
    [loadProjects, toast]
  );

  const deleteProject = useCallback(
    async (token: string) => {
      try {
        const response = await fetch(`/api/projects?token=${encodeURIComponent(token)}`, {
          method: "DELETE",
          headers: withAuthHeaders(),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "删除失败");
        }
        await loadProjects();
        toast({ title: "项目已删除", status: "success", duration: 2000 });
      } catch (error) {
        toast({
          title: "删除失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
    },
    [loadProjects, toast]
  );

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  return {
    projects,
    loading,
    creating,
    loadProjects,
    createProject,
    openProject,
    renameProject,
    deleteProject,
    formatDate,
  };
}
