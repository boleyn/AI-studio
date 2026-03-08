import { useState } from "react";
import { Box, Button, Flex, FormControl, FormLabel, Input, Text, useToast } from "@chakra-ui/react";
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
  const pwdStrength = newPwd.length >= 12 ? "strong" : newPwd.length >= 8 ? "medium" : "weak";

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
    <Box w="100%" textAlign="left">
      <Flex
        align="center"
        justify="space-between"
        borderRadius="14px"
        border="1px solid rgba(148,163,184,0.24)"
        bg="linear-gradient(135deg, rgba(225,234,255,0.62) 0%, rgba(247,250,255,0.72) 100%)"
        p={4}
        mb={4}
      >
        <Box>
          <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.08em" color="myGray.500">
            Security Matrix
          </Text>
          <Text fontSize="sm" color="myGray.700" mt={1}>
            建议 8 位以上，包含字母、数字与符号
          </Text>
        </Box>
        <Box
          px={3}
          py={1}
          borderRadius="999px"
          bg={pwdStrength === "strong" ? "green.100" : pwdStrength === "medium" ? "yellow.100" : "red.100"}
          color={pwdStrength === "strong" ? "green.700" : pwdStrength === "medium" ? "yellow.700" : "red.700"}
          fontSize="xs"
          fontWeight="700"
          textTransform="uppercase"
        >
          {pwdStrength}
        </Box>
      </Flex>

      <Flex gap={3} direction={{ base: "column", md: "row" }}>
        <Box flex={1}>
          <FormControl mb={4}>
            <FormLabel fontSize="sm" color="myGray.700">
              原密码
            </FormLabel>
            <Input
              type="password"
              placeholder="请输入原密码"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
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
              _placeholder={{ color: "myGray.400" }}
            />
          </FormControl>
        </Box>
        <Box
          w={{ base: "100%", md: "220px" }}
          borderRadius="14px"
          border="1px dashed rgba(148,163,184,0.42)"
          bg="rgba(255,255,255,0.55)"
          p={4}
        >
          <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.08em" color="myGray.500" mb={2}>
            Rule Check
          </Text>
          <Text fontSize="sm" color={newPwd.length >= 6 ? "green.700" : "myGray.600"} mb={1.5}>
            {newPwd.length >= 6 ? "✓" : "•"} 长度至少 6 位
          </Text>
          <Text fontSize="sm" color={newPwd.length >= 8 ? "green.700" : "myGray.600"} mb={1.5}>
            {newPwd.length >= 8 ? "✓" : "•"} 推荐长度 8 位以上
          </Text>
          <Text fontSize="sm" color={newPwd === newPwd2 && newPwd2 ? "green.700" : "myGray.600"}>
            {newPwd === newPwd2 && newPwd2 ? "✓" : "•"} 两次输入一致
          </Text>
        </Box>
      </Flex>

      <Flex justify="flex-end">
        <Button
          variant="primary"
          w={{ base: "100%", md: "240px" }}
          onClick={handleSubmit}
          isLoading={submitting}
          sx={{
            height: "48px !important",
            minHeight: "48px !important",
            lineHeight: "1.2 !important",
            paddingTop: "0 !important",
            paddingBottom: "0 !important",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
          }}
        >
          确认修改
        </Button>
      </Flex>
    </Box>
  );
}
