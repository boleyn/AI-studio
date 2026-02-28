import { type Dispatch, useState } from "react";
import { FormControl, Box, Input, Button, FormErrorMessage, Flex } from "@chakra-ui/react";
import FormLayout from "./FormLayout";
import { LoginPageTypeEnum } from "./constants";
import { useToast } from "@chakra-ui/react";
import type { AuthSuccessPayload } from "./LoginForm";

interface Props {
  onSuccess: (e: AuthSuccessPayload) => void;
  setPageType: Dispatch<LoginPageTypeEnum>;
}

const RegisterForm = ({ setPageType, onSuccess }: Props) => {
  const toast = useToast();
  const [form, setForm] = useState({ username: "", password: "", password2: "" });
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!form.username) {
      setError("请输入账号或邮箱");
      return;
    }
    if (!form.password || form.password.length < 6) {
      setError("密码至少 6 位字符");
      return;
    }
    if (form.password !== form.password2) {
      setError("两次密码不一致");
      return;
    }

    setRequesting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { token?: string; user?: AuthSuccessPayload["user"]; error?: string }
        | null;
      if (!response.ok || !payload?.token) {
        throw new Error(payload?.error || "注册失败，请稍后再试");
      }
      onSuccess({ token: payload.token, user: payload.user! });
      toast({ status: "success", title: "注册成功，欢迎开始" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败，请稍后再试");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <FormLayout setPageType={setPageType} pageType={LoginPageTypeEnum.register}>
      <Box
        mt={6}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !requesting) {
            handleSubmit();
          }
        }}
      >
        <FormControl isInvalid={!!error}>
          <Input
            bg="myGray.50"
            size="lg"
            placeholder="邮箱 / 手机号 / 账号"
            value={form.username}
            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
          />
        </FormControl>
        <FormControl mt={6} isInvalid={!!error}>
          <Input
            bg="myGray.50"
            size="lg"
            type="password"
            placeholder="设置登录密码"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
          />
        </FormControl>
        <FormControl mt={6} isInvalid={!!error}>
          <Input
            bg="myGray.50"
            size="lg"
            type="password"
            placeholder="再次输入密码"
            value={form.password2}
            onChange={(e) => setForm((prev) => ({ ...prev, password2: e.target.value }))}
          />
          {error && <FormErrorMessage>{error}</FormErrorMessage>}
        </FormControl>
        <Button
          mt={12}
          w="100%"
          size="md"
          rounded="md"
          h={10}
          fontWeight="medium"
          variant="primary"
          isLoading={requesting}
          onClick={handleSubmit}
        >
          创建账号
        </Button>
        <Flex justify="flex-end" align="center" gap={3} mt={3} fontSize="mini" fontWeight="medium" color="primary.700">
          <Box
            cursor="pointer"
            _hover={{ textDecoration: "underline" }}
            onClick={() => setPageType(LoginPageTypeEnum.forgot)}
          >
            忘记密码
          </Box>
          <Box h="12px" w="1px" bg="myGray.250" />
          <Box cursor="pointer" _hover={{ textDecoration: "underline" }} onClick={() => setPageType(LoginPageTypeEnum.password)}>
            已有账号，去登录
          </Box>
        </Flex>
      </Box>
    </FormLayout>
  );
};

export default RegisterForm;
