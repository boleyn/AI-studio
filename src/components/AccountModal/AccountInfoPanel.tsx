import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Text,
  useToast,
} from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type { AuthUser } from "../../types/auth";

type AccountInfoPanelProps = {
  user: AuthUser | null;
  onSaved?: () => Promise<void> | void;
};

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";

export function AccountInfoPanel({ user, onSaved }: AccountInfoPanelProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const normalizeAvatar = (value?: string) => {
    const raw = (value || "").trim();
    if (!raw) return DEFAULT_AVATAR;
    if (/^data:image\//i.test(raw)) return DEFAULT_AVATAR;
    return raw;
  };

  useEffect(() => {
    setDisplayName(user?.displayName || user?.username || "");
    setAvatar(normalizeAvatar(user?.avatar));
    setIsEditing(false);
  }, [user?.avatar, user?.displayName, user?.username]);

  const username = user?.username || "";
  const contact = user?.contact || "普通账户";
  const provider = user?.provider || "password";
  const hasChanged = useMemo(() => {
    const nextName = displayName.trim();
    const nextAvatar = avatar.trim() || DEFAULT_AVATAR;
    const currName = (user?.displayName || user?.username || "").trim();
    const currAvatar = (user?.avatar || DEFAULT_AVATAR).trim();
    return nextName !== currName || nextAvatar !== currAvatar;
  }, [avatar, displayName, user?.avatar, user?.displayName, user?.username]);

  const resetForm = () => {
    setDisplayName(user?.displayName || user?.username || "");
    setAvatar(normalizeAvatar(user?.avatar));
  };

  const handleSave = async () => {
    const name = displayName.trim();
    const avatarValue = avatar.trim() || DEFAULT_AVATAR;
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
      setIsEditing(false);
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
    <Flex gap={5} direction="column">
      {!isEditing ? (
        <>
          <Flex
            align="center"
            justify="space-between"
            p={4}
            borderRadius="16px"
            border="1px solid rgba(148,163,184,0.26)"
            bg="linear-gradient(135deg, rgba(225,234,255,0.7) 0%, rgba(246,250,255,0.82) 56%, rgba(236,252,243,0.62) 100%)"
          >
            <Flex align="center" gap={4} minW={0}>
              <Avatar size="lg" name={displayName || username || "用户"} src={avatar || DEFAULT_AVATAR} />
              <Box minW={0}>
                <Text fontSize="lg" fontWeight="700" color="myGray.800" noOfLines={1}>
                  {displayName || "未命名用户"}
                </Text>
                <Text fontSize="sm" color="myGray.500" mt={1} noOfLines={1}>
                  @{username || "user"}
                </Text>
              </Box>
            </Flex>
            <Badge colorScheme="green" variant="subtle">
              ACTIVE
            </Badge>
          </Flex>

          <Box
            borderRadius="14px"
            border="1px solid rgba(148,163,184,0.24)"
            bg="rgba(255,255,255,0.74)"
            p={4}
          >
            <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.08em" color="myGray.500" mb={2}>
              Profile Meta
            </Text>
            <Flex align="center" justify="space-between" gap={3}>
              <Text fontSize="sm" color="myGray.700">联系方式</Text>
              <Text fontSize="sm" color="myGray.800" fontWeight="600">
                {contact}
              </Text>
            </Flex>
            <Flex align="center" justify="space-between" gap={3} mt={2.5}>
              <Text fontSize="sm" color="myGray.700">认证方式</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.800">
                {provider}
              </Text>
            </Flex>
          </Box>

          <Flex justify="flex-end">
            <Button variant="primary" onClick={() => setIsEditing(true)}>
              编辑资料
            </Button>
          </Flex>
        </>
      ) : (
        <>
          <Flex
            align="center"
            justify="space-between"
            p={4}
            borderRadius="16px"
            border="1px solid rgba(148,163,184,0.26)"
            bg="linear-gradient(135deg, rgba(225,234,255,0.7) 0%, rgba(246,250,255,0.82) 56%, rgba(236,252,243,0.62) 100%)"
          >
            <Flex align="center" gap={4} minW={0}>
              <Box position="relative">
                <Avatar size="lg" name={displayName || username || "用户"} src={avatar || DEFAULT_AVATAR} />
                <Button
                  size="xs"
                  h="24px"
                  minW="24px"
                  px={2}
                  position="absolute"
                  right="-8px"
                  bottom="-8px"
                  borderRadius="999px"
                  variant="whitePrimary"
                  onClick={handlePickAvatar}
                  isDisabled={uploadingAvatar}
                >
                  {uploadingAvatar ? "..." : "改"}
                </Button>
              </Box>
              <Box minW={0}>
                <Text fontSize="lg" fontWeight="700" color="myGray.800" noOfLines={1}>
                  {displayName || "未命名用户"}
                </Text>
                <Text fontSize="sm" color="myGray.500" mt={1} noOfLines={1}>
                  @{username || "user"}
                </Text>
              </Box>
            </Flex>
            <Badge colorScheme="blue" variant="subtle">
              EDITING
            </Badge>
          </Flex>

          <Flex gap={3} direction={{ base: "column", md: "row" }}>
            <Box
              flex="1"
              p={4}
              borderRadius="14px"
              border="1px solid rgba(148,163,184,0.24)"
              bg="rgba(255,255,255,0.74)"
            >
              <FormControl>
                <FormLabel fontSize="sm" color="myGray.700" mb={1.5}>
                  显示名称
                </FormLabel>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="输入显示名称"
                />
              </FormControl>
            </Box>
            <Box
              flex="1.3"
              p={4}
              borderRadius="14px"
              border="1px solid rgba(148,163,184,0.24)"
              bg="rgba(255,255,255,0.74)"
            >
              <FormControl>
                <FormLabel fontSize="sm" color="myGray.700" mb={1.5}>
                  头像地址
                </FormLabel>
                <Input
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  placeholder="https://... 或 /icons/defaultAvatar.svg"
                />
              </FormControl>
              <Flex mt={2.5} align="center" gap={2}>
                <Button size="sm" variant="whitePrimary" onClick={handlePickAvatar} isDisabled={uploadingAvatar}>
                  {uploadingAvatar ? "上传中..." : "上传头像"}
                </Button>
                <Text fontSize="xs" color="myGray.500">
                  支持 png/jpg/webp/gif，最大 8MB
                </Text>
              </Flex>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </Box>
          </Flex>

          <Flex justify="flex-end" gap={2.5}>
            <Button
              variant="whitePrimary"
              onClick={() => {
                resetForm();
                setIsEditing(false);
              }}
              isDisabled={saving}
            >
              取消
            </Button>
            <Button variant="whitePrimary" onClick={resetForm} isDisabled={saving || !hasChanged}>
              重置
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              isLoading={saving}
              isDisabled={!hasChanged || uploadingAvatar}
            >
              保存资料
            </Button>
          </Flex>
        </>
      )}
    </Flex>
  );
}
