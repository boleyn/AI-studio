import { type Dispatch, useState } from "react";
import { Flex, Button, Box, Text } from "@chakra-ui/react";
import FormLayout from "./FormLayout";
import { LoginPageTypeEnum } from "./constants";
import { useToast } from "@chakra-ui/react";
import { LockKeyhole, UserRound } from "lucide-react";
import AuthInputField from "./AuthInputField";

export type AuthSuccessPayload = {
  token: string;
  user: { id: string; username: string; displayName?: string; contact?: string; avatar?: string; provider?: string };
};

interface Props {
  setPageType: Dispatch<LoginPageTypeEnum>;
  onSuccess: (e: AuthSuccessPayload) => void;
}

interface LoginFormType {
  username: string;
  password: string;
}

const LoginForm = ({ setPageType, onSuccess }: Props) => {
  const toast = useToast();
  const [form, setForm] = useState<LoginFormType>({ username: "", password: "" });
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!form.username || !form.password) {
      setError("请输入账号与密码");
      return;
    }
    setRequesting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { token?: string; user?: AuthSuccessPayload["user"]; error?: string }
        | null;
      if (!response.ok || !payload?.token) {
        throw new Error(payload?.error || "登录失败，请重试");
      }
      onSuccess({ token: payload.token, user: payload.user! });
      toast({ status: "success", title: "已进入工作台" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <FormLayout setPageType={setPageType} pageType={LoginPageTypeEnum.password}>
      <Box
        mt={8}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !requesting) {
            handleSubmit();
          }
        }}
      >
        <AuthInputField
          icon={<UserRound size={16} />}
          isInvalid={!!error}
          placeholder="邮箱 / 手机号 / 账号"
          value={form.username}
          onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
        />
        <Box mt={5}>
          <AuthInputField
            icon={<LockKeyhole size={16} />}
            isInvalid={!!error}
            type="password"
            placeholder="输入密码"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            error={error}
          />
        </Box>
        <Text mt={2} color="myGray.400" fontSize="mini">
          你的账号凭证将被安全加密，仅用于身份验证。
        </Text>

        <Button
          mt={6}
          w="100%"
          size="lg"
          h="48px"
          minH="48px"
          fontSize="md"
          lineHeight="1"
          fontWeight="medium"
          variant="primary"
          isLoading={requesting}
          onClick={handleSubmit}
        >
          进入工作台
        </Button>

        <Flex align="center" justifyContent={["flex-end", "center"]} color="primary.700" fontWeight="medium" mt={4}>
          <Box
            cursor="pointer"
            _hover={{ textDecoration: "underline" }}
            onClick={() => setPageType(LoginPageTypeEnum.forgot)}
            fontSize="mini"
          >
            忘记密码
          </Box>
          <Flex alignItems="center">
            <Box mx={3} h="12px" w="1px" bg="myGray.250" />
            <Box
              cursor="pointer"
              _hover={{ textDecoration: "underline" }}
              onClick={() => setPageType(LoginPageTypeEnum.register)}
              fontSize="mini"
            >
              创建账号
            </Box>
          </Flex>
        </Flex>
      </Box>
    </FormLayout>
  );
};

export default LoginForm;
