import { useState } from "react";
import { Box, Button, FormControl, FormLabel, Input, useToast } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type AccountPasswordPanelProps = {
  onSuccess: () => void;
};

export function AccountPasswordPanel({ onSuccess }: AccountPasswordPanelProps) {
  const toast = useToast();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
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
    <Box w="100%" maxW="320px" textAlign="left">
      <FormControl mb={4}>
        <FormLabel fontSize="sm" color="myGray.700">
          原密码
        </FormLabel>
        <Input
          type="password"
          placeholder="请输入原密码"
          value={oldPwd}
          onChange={(e) => setOldPwd(e.target.value)}
          borderColor="myGray.200"
          _placeholder={{ color: "myGray.400" }}
        />
      </FormControl>
      <FormControl mb={4}>
        <FormLabel fontSize="sm" color="myGray.700">
          新密码
        </FormLabel>
        <Input
          type="password"
          placeholder="至少 6 位"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          borderColor="myGray.200"
          _placeholder={{ color: "myGray.400" }}
        />
      </FormControl>
      <FormControl mb={5}>
        <FormLabel fontSize="sm" color="myGray.700">
          确认新密码
        </FormLabel>
        <Input
          type="password"
          placeholder="再次输入新密码"
          value={newPwd2}
          onChange={(e) => setNewPwd2(e.target.value)}
          borderColor="myGray.200"
          _placeholder={{ color: "myGray.400" }}
        />
      </FormControl>
      <Button variant="primary" w="100%" onClick={handleSubmit} isLoading={submitting}>
        确认修改
      </Button>
    </Box>
  );
}
