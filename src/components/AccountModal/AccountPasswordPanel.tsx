import { useMemo, useState } from "react";
import { Box, Button, Flex, FormControl, FormLabel, HStack, Input, Text, useToast } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { AppPanelFooter, AppPanelHeader } from "../ui";

type AccountPasswordPanelProps = {
  onSuccess: () => void;
};

export function AccountPasswordPanel({ onSuccess }: AccountPasswordPanelProps) {
  const toast = useToast();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => {
    if (!newPwd) return null;
    if (newPwd.length >= 12) return { label: "强", color: "#16a34a" };
    if (newPwd.length >= 8) return { label: "中", color: "#d97706" };
    return { label: "弱", color: "#dc2626" };
  }, [newPwd]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!oldPwd || !newPwd || !newPwd2) {
      toast({ title: "请填写全部字段", status: "warning", duration: 2000 });
      return;
    }
    if (newPwd.length < 6) {
      toast({ title: "新密码至少 6 位", status: "warning", duration: 2000 });
      return;
    }
    if (newPwd !== newPwd2) {
      toast({ title: "两次新密码不一致", status: "warning", duration: 2000 });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withAuthHeaders() },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "修改失败", status: "error", duration: 3000 });
        return;
      }
      onSuccess();
      setOldPwd("");
      setNewPwd("");
      setNewPwd2("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex as="form" onSubmit={(e) => void handleSubmit(e)} h="100%" direction="column">
      <AppPanelHeader
        title="修改密码"
        description="更新访问账号的登录密码，建议至少 6 位并包含字母与数字。"
      />

      <Box flex={1}>
        <FormControl mb={4}>
          <FormLabel fontSize="13px" fontWeight="500" color="ink.primary" mb={1.5}>
            原密码
          </FormLabel>
          <Input
            size="md"
            h="40px"
            type="password"
            placeholder="请输入当前使用的密码"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
          />
        </FormControl>

        <FormControl mb={4}>
          <HStack justify="space-between" mb={1.5}>
            <FormLabel fontSize="13px" fontWeight="500" color="ink.primary" mb={0}>
              新密码
            </FormLabel>
            {strength && (
              <Text fontSize="12px" fontWeight="500" color={strength.color}>
                密码强度：{strength.label}
              </Text>
            )}
          </HStack>
          <Input
            size="md"
            h="40px"
            type="password"
            placeholder="至少 6 位，建议包含字母与数字"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
          />
        </FormControl>

        <FormControl>
          <FormLabel fontSize="13px" fontWeight="500" color="ink.primary" mb={1.5}>
            确认新密码
          </FormLabel>
          <Input
            size="md"
            h="40px"
            type="password"
            placeholder="再次输入以确认新密码"
            value={newPwd2}
            onChange={(e) => setNewPwd2(e.target.value)}
          />
          {newPwd && newPwd2 && newPwd !== newPwd2 ? (
            <Text mt={1.5} fontSize="12px" color="red.600">
              两次输入不一致，请重试。
            </Text>
          ) : null}
        </FormControl>
      </Box>

      <AppPanelFooter hint="密码修改完成后系统将使用新密码验证。">
        <Button type="submit" variant="primary" size="sm" isLoading={submitting}>
          保存新密码
        </Button>
      </AppPanelFooter>
    </Flex>
  );
}
