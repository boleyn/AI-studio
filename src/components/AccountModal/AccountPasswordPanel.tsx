import { useMemo, useState } from "react";
import { Box, Button, Flex, FormControl, FormLabel, Input, Text, useToast, Divider } from "@chakra-ui/react";
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

  const strength = useMemo(() => {
    if (newPwd.length >= 12) return { label: "强", bg: "green.50", color: "green.600", border: "green.200" };
    if (newPwd.length >= 8) return { label: "中", bg: "yellow.50", color: "yellow.600", border: "yellow.200" };
    return { label: "弱", bg: "red.50", color: "red.600", border: "red.200" };
  }, [newPwd]);

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
    <Flex h="100%" direction="column">
      <Box mb={8}>
        <Text fontSize="2xl" fontWeight="700" color="myGray.800" pb={1}>
          安全设置
        </Text>
        <Text fontSize="sm" color="myGray.500">
          更新您可以访问账号和项目的凭证。我们建议使用强密码。
        </Text>
      </Box>

      {/* 移除了内嵌框体的样式（框中框） */}
      <Box w="100%">
        <Flex
          align="center"
          justify="space-between"
          mb={8}
        >
          <Box>
            <Text fontSize="md" fontWeight="600" color="myGray.800">
              重置登录密码
            </Text>
            <Text fontSize="sm" color="myGray.500" mt={1}>
              建议包含大小写字母、数字及特殊符号组合。
            </Text>
          </Box>
          <Box
            px={4}
            py={1.5}
            borderRadius="full"
            bg={strength.bg}
            color={strength.color}
            border={`1px solid`}
            borderColor={strength.border}
            fontSize="xs"
            fontWeight="bold"
            letterSpacing="widest"
          >
            强度 {strength.label}
          </Box>
        </Flex>

        <Divider borderColor="var(--ws-border)" mb={6} />

        <FormControl mb={5} maxW="400px">
          <FormLabel fontSize="sm" fontWeight="600" color="myGray.700">
            原密码
          </FormLabel>
          <Input
            type="password"
            placeholder="请输入当前使用的密码"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            bg="white"
            size="lg"
            borderRadius="xl"
            border="1px solid var(--ws-border)"
            _placeholder={{ color: "myGray.400" }}
            _focus={{ borderColor: "green.400", boxShadow: "0 0 0 1px #32D583" }}
          />
        </FormControl>

        <FormControl mb={5} maxW="400px">
          <FormLabel fontSize="sm" fontWeight="600" color="myGray.700">
            新密码
          </FormLabel>
          <Input
            type="password"
            placeholder="至少 8 位，包含字母与数字"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            bg="white"
            size="lg"
            borderRadius="xl"
            border="1px solid var(--ws-border)"
            _placeholder={{ color: "myGray.400" }}
            _focus={{ borderColor: "green.400", boxShadow: "0 0 0 1px #32D583" }}
          />
        </FormControl>

        <FormControl maxW="400px">
          <FormLabel fontSize="sm" fontWeight="600" color="myGray.700">
            确认新密码
          </FormLabel>
          <Input
            type="password"
            placeholder="再次输入以确认新密码"
            value={newPwd2}
            onChange={(e) => setNewPwd2(e.target.value)}
            bg="white"
            size="lg"
            borderRadius="xl"
            border="1px solid var(--ws-border)"
            _placeholder={{ color: "myGray.400" }}
            _focus={{ borderColor: "green.400", boxShadow: "0 0 0 1px #32D583" }}
          />
          <Text
            mt={2.5}
            fontSize="xs"
            fontWeight="500"
            color={newPwd && newPwd2 && newPwd !== newPwd2 ? "red.500" : "myGray.400"}
          >
            {newPwd && newPwd2 && newPwd !== newPwd2 ? "两次输入不一致，请重试。" : "修改并提交后，系统将使用新密码再次验证。"}
          </Text>
        </FormControl>
      </Box>

      <Flex flex={1} />
      
      <Flex mt={8} pt={6} borderTop="1px solid var(--ws-border)" justify="space-between" align="center">
        <Text fontSize="sm" color="myGray.500">
          密码修改完成后你将需要重新登录。
        </Text>
        <Button
          onClick={handleSubmit}
          isLoading={submitting}
          size="md"
          borderRadius="xl"
          px={8}
          bg="green.500"
          color="white"
          _hover={{ bg: "green.600" }}
          _active={{ bg: "green.700" }}
          boxShadow="0 4px 12px -4px rgba(18, 183, 106, 0.4)"
        >
          保存新密码
        </Button>
      </Flex>
    </Flex>
  );
}
