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
      <Box mb={8}>
        <Text fontSize="2xl" fontWeight="700" color="myGray.800" pb={1}>
          个人资料设置
        </Text>
        <Text fontSize="sm" color="myGray.500">
          管理您在这里的基础身份信息，名称将对外展示。
        </Text>
      </Box>

      {/* 移除了导致“框中框”的背景和边框 */}
      <Box w="100%">
        <Flex gap={8} direction={{ base: "column", md: "row" }} align="flex-start">
          <Flex direction="column" align="center" gap={3}>
            <Box position="relative" role="group">
              <Avatar
                size="2xl"
                name={displayName || username || "用户"}
                src={avatar || DEFAULT_AVATAR}
                border="3px solid white"
                boxShadow="var(--ws-glow-soft)"
                transition="all 0.2s"
              />
              <Button
                size="sm"
                position="absolute"
                bottom="-6px"
                left="50%"
                transform="translateX(-50%)"
                borderRadius="full"
                variant="whitePrimary"
                border="1px solid var(--ws-border)"
                boxShadow="md"
                onClick={handlePickAvatar}
                isDisabled={uploadingAvatar}
                opacity="0"
                _groupHover={{ opacity: 1, bottom: "-2px" }}
                transition="all 0.2s"
              >
                {uploadingAvatar ? "上传中" : "更换头像"}
              </Button>
            </Box>
            <Text fontSize="11px" color="myGray.400" textAlign="center">
              PNG, JPG, Max 8MB
            </Text>
          </Flex>

          <Divider orientation="vertical" borderColor="var(--ws-border)" h="120px" display={{ base: "none", md: "block" }} />

          <Box flex={1} w="100%">
            <FormControl>
              <FormLabel fontSize="sm" fontWeight="600" color="myGray.700" mb={2}>
                显示名称
              </FormLabel>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="输入你的显示名称"
                maxLength={40}
                size="lg"
                bg="white"
                border="1px solid var(--ws-border)"
                borderRadius="xl"
                fontSize="md"
                _hover={{ borderColor: "myGray.300" }}
                _focus={{ borderColor: "green.400", boxShadow: "0 0 0 1px #32D583" }}
              />
            </FormControl>

            <FormControl mt={6}>
              <FormLabel fontSize="sm" fontWeight="600" color="myGray.700" mb={2}>
                当前账号 (Username)
              </FormLabel>
              <Input
                value={username}
                isReadOnly
                size="lg"
                bg="rgba(17, 24, 36, 0.02)"
                border="1px solid transparent"
                borderRadius="xl"
                color="myGray.500"
                fontSize="md"
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

      <Flex flex={1} />
      
      <Flex mt={8} pt={6} borderTop="1px solid var(--ws-border)" justify="space-between" align="center">
        <Text fontSize="sm" color="myGray.500">
          如果您未遇到问题，建议不要轻易修改你的基本信息。
        </Text>
        <Flex gap={3}>
          <Button
            variant="ghost"
            onClick={resetForm}
            isDisabled={saving || uploadingAvatar || !hasChanged}
            size="md"
            borderRadius="xl"
            px={6}
          >
            撤销更改
          </Button>
          <Button
            onClick={handleSave}
            isLoading={saving}
            isDisabled={!hasChanged || uploadingAvatar}
            size="md"
            borderRadius="xl"
            px={8}
            bg="green.500"
            color="white"
            _hover={{ bg: "green.600" }}
            _active={{ bg: "green.700" }}
            boxShadow="0 4px 12px -4px rgba(18, 183, 106, 0.4)"
          >
            保存设置
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
