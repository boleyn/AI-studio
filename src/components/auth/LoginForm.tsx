import { type Dispatch, useState } from "react";
import { Flex, Button, Box } from "@chakra-ui/react";
import FormLayout from "./FormLayout";
import { LoginPageTypeEnum } from "./constants";
import { useToast } from "@chakra-ui/react";
import { LockKeyhole, UserRound } from "lucide-react";
import AuthInputField from "./AuthInputField";

export type AuthSuccessPayload = {
  token: string;
  user: {
    id: string;
    username: string;
    displayName?: string;
    contact?: string;
    avatar?: string;
    primaryModel?: string;
    provider?: string;
  };
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
      <form method="post" action="/api/auth/login" onSubmit={(event) => {
        event.preventDefault();
        if (!requesting) void handleSubmit();
      }}>
        <AuthInputField
          icon={<UserRound size={16} />}
          isInvalid={!!error}
          label="账号" name="username" autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false}
          placeholder="邮箱、手机号或账号"
          value={form.username}
          onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
        />
        <Box mt={5}>
          <AuthInputField
            icon={<LockKeyhole size={16} />}
            isInvalid={!!error}
            type="password"
            label="密码" name="password" autoComplete="current-password"
            placeholder="输入密码"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            error={error}
          />
        </Box>
        <Button
          mt={6}
          w="100%"
          size="lg"
          h="48px"
          minH="48px"
          fontSize="md"
          lineHeight="1"
          fontWeight="medium"
          bg="var(--ws-text-main)" color="white" borderRadius="12px" _hover={{ bg: "#303a48" }}
          isLoading={requesting}
          type="submit"
        >
          登录
        </Button>

        <Flex justify="space-between" mt={3} color="var(--ws-text-subtle)" fontSize="sm">
          <button type="button" onClick={() => setPageType(LoginPageTypeEnum.forgot)}>忘记密码？</button>
          <button type="button" onClick={() => setPageType(LoginPageTypeEnum.register)}>创建账号</button>
        </Flex>
      </form>
    </FormLayout>
  );
};

export default LoginForm;
