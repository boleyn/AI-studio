import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Avatar,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Text,
  useToast,
  Divider,
} from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type { AuthUser } from "../../types/auth";
import { AppPanelFooter, AppPanelHeader } from "../ui";

type AccountInfoPanelProps = {
  user: AuthUser | null;
  onSaved?: () => Promise<void> | void;
};

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";

function normalizeAvatar(value?: string) {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  if (/^data:image\//i.test(raw)) return DEFAULT_AVATAR;
  return raw;
}

export function AccountInfoPanel({ user, onSaved }: AccountInfoPanelProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName || user?.username || "");
    setAvatar(normalizeAvatar(user?.avatar));
  }, [user?.avatar, user?.displayName, user?.username]);

  const username = user?.username || "";
  const hasChanged = useMemo(() => {
    const nextName = displayName.trim();
    const nextAvatar = normalizeAvatar(avatar);
    const currName = (user?.displayName || user?.username || "").trim();
    const currAvatar = normalizeAvatar(user?.avatar);
    return nextName !== currName || nextAvatar !== currAvatar;
  }, [avatar, displayName, user?.avatar, user?.displayName, user?.username]);

  const resetForm = () => {
    setDisplayName(user?.displayName || user?.username || "");
    setAvatar(normalizeAvatar(user?.avatar));
  };

  const handleSave = async () => {
    const name = displayName.trim();
    const avatarValue = normalizeAvatar(avatar);

    if (!name) {
      toast({ status: "warning", title: "名称不能为空", duration: 2000 });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...withAuthHeaders() },
        body: JSON.stringify({ displayName: name, avatar: avatarValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ status: "error", title: data.error || "保存失败", duration: 2500 });
        return;
      }
      await onSaved?.();
      toast({ status: "success", title: "资料已更新", duration: 1800 });
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ status: "warning", title: "请选择图片文件", duration: 2000 });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ status: "warning", title: "图片请控制在 8MB 以内", duration: 2000 });
      return;
    }

    setUploadingAvatar(true);
    try {
      const presignRes = await fetch("/api/auth/avatar/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withAuthHeaders() },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      const presignPayload = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok || !presignPayload?.url || !presignPayload?.publicUrl) {
        throw new Error(presignPayload?.error || "生成上传地址失败");
      }

      const uploadRes = await fetch(String(presignPayload.url), {
        method: "PUT",
        headers: presignPayload.headers || {},
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error("上传到对象存储失败");
      }
      setAvatar(String(presignPayload.publicUrl));
      toast({ status: "success", title: "头像已上传", duration: 1500 });
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "头像上传失败",
        duration: 2200,
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <Flex h="100%" direction="column">
      <AppPanelHeader
        title="个人资料设置"
        description="管理您的基础身份信息，显示名称与头像将对外展示。"
      />

      <Box w="100%" flex={1}>
        <Flex gap={8} direction={{ base: "column", md: "row" }} align="flex-start">
          <Flex direction="column" align="center" gap={2.5}>
            <Box position="relative" role="group">
              <Avatar
                size="xl"
                name={displayName || username || "用户"}
                src={avatar || DEFAULT_AVATAR}
                border="1px solid"
                borderColor="stroke.subtle"
              />
              <Button
                size="xs"
                position="absolute"
                bottom="-4px"
                left="50%"
                transform="translateX(-50%)"
                borderRadius="full"
                variant="outline"
                onClick={handlePickAvatar}
                isDisabled={uploadingAvatar}
                opacity="0"
                _groupHover={{ opacity: 1 }}
                transition="opacity 0.15s"
              >
                {uploadingAvatar ? "上传中" : "更换"}
              </Button>
            </Box>
            <Text fontSize="11px" color="ink.muted" textAlign="center">
              PNG, JPG · 最大 8MB
            </Text>
          </Flex>

          <Divider orientation="vertical" borderColor="stroke.light" h="120px" display={{ base: "none", md: "block" }} />

          <Box flex={1} w="100%">
            <FormControl>
              <FormLabel fontSize="13px" fontWeight="500" color="ink.primary" mb={1.5}>
                显示名称
              </FormLabel>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="输入你的显示名称"
                maxLength={40}
                size="md"
              />
            </FormControl>

            <FormControl mt={4}>
              <FormLabel fontSize="13px" fontWeight="500" color="ink.primary" mb={1.5}>
                当前账号
              </FormLabel>
              <Input
                value={username}
                isReadOnly
                size="md"
                bg="surface.sidebar"
                color="ink.secondary"
              />
            </FormControl>
          </Box>
        </Flex>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </Box>

      <AppPanelFooter hint="如需变更登录密码，请前往安全设置。">
        <Button
          variant="ghost"
          size="sm"
          onClick={resetForm}
          isDisabled={saving || uploadingAvatar || !hasChanged}
        >
          撤销更改
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          isLoading={saving}
          isDisabled={!hasChanged || uploadingAvatar}
        >
          保存设置
        </Button>
      </AppPanelFooter>
    </Flex>
  );
}
