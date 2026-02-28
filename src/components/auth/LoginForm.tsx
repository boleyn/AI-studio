import { type Dispatch, useState } from "react";
import { FormControl, Flex, Input, Button, Box, FormErrorMessage } from "@chakra-ui/react";
import FormLayout from "./FormLayout";
import { LoginPageTypeEnum } from "./constants";
import { useToast } from "@chakra-ui/react";

export type AuthSuccessPayload = {
  token: string;
  user: { id: string; username: string; contact?: string; provider?: string };
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
        <FormControl isInvalid={!!error}>
          <Input
            bg="myGray.50"
            size="lg"
            placeholder="邮箱 / 手机号 / 账号"
            value={form.username}
            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
          />
        </FormControl>
        <FormControl mt={7} isInvalid={!!error}>
          <Input
            bg="myGray.50"
            size="lg"
            type="password"
            placeholder="输入密码"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          {error && <FormErrorMessage>{error}</FormErrorMessage>}
        </FormControl>

        <Button
          my={[5, 7]}
          w="100%"
          size="md"
          h={10}
          fontWeight="medium"
          variant="primary"
          isLoading={requesting}
          onClick={handleSubmit}
        >
          进入工作台
        </Button>

        <Flex align="center" justifyContent={["flex-end", "center"]} color="primary.700" fontWeight="medium">
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
