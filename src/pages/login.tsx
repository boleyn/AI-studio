import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import styles from "../components/auth/AuthPage.module.css";
import BoreCompanion from "../components/auth/BoreCompanion";
import LoginForm, { type AuthSuccessPayload } from "../components/auth/LoginForm";
import RegisterForm from "../components/auth/RegisterForm";
import FeishuForm from "../components/auth/FeishuForm";
import ForgetPasswordForm from "../components/auth/ForgetPasswordForm";
import { LoginPageTypeEnum } from "../components/auth/constants";
import { clearAuthToken, getAuthToken, setAuthToken, withAuthHeaders } from "@features/auth/client/authClient";

const getLastRoute = (value: string | string[] | undefined) => {
  if (!value) return "";
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!raw?.startsWith("/") || raw.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(raw)) return "";
  return raw.split("?lastRoute=")[0];
};

const titles = {
  [LoginPageTypeEnum.password]: "欢迎回来",
  [LoginPageTypeEnum.register]: "创建账号",
  [LoginPageTypeEnum.feishu]: "飞书登录",
  [LoginPageTypeEnum.forgot]: "找回密码",
};

const Login = () => {
  const router = useRouter();
  const { lastRoute = "" } = router.query as { lastRoute: string };
  const [pageType, setPageType] = useState<LoginPageTypeEnum>(LoginPageTypeEnum.password);
  const redirectWithReload = useCallback(
    (target: string) => {
      if (typeof window !== "undefined") {
        window.location.replace(target);
        return;
      }
      void router.replace(target);
    },
    [router]
  );

  useEffect(() => {
    if (!router.isReady) return;
    const token = getAuthToken();
    if (!token) return;

    let cancelled = false;
    const verifyAndRedirect = async () => {
      try {
        const response = await fetch("/api/auth/me", { headers: withAuthHeaders() });
        if (!response.ok) {
          clearAuthToken();
          return;
        }
        if (!cancelled) {
          redirectWithReload(getLastRoute(lastRoute) || "/");
        }
      } catch {
        clearAuthToken();
      }
    };

    void verifyAndRedirect();

    return () => {
      cancelled = true;
    };
  }, [router.isReady, lastRoute, redirectWithReload]);

  const loginSuccess = useCallback(
    (res: AuthSuccessPayload) => {
      if (res?.token) {
        setAuthToken(res.token);
      }
      const target = getLastRoute(lastRoute) || "/";
      redirectWithReload(target);
    },
    [lastRoute, redirectWithReload]
  );

  const safeLastRoute = getLastRoute(lastRoute);


  const DynamicComponent = useMemo(() => {
    if (pageType === LoginPageTypeEnum.register) {
      return <RegisterForm setPageType={setPageType} onSuccess={loginSuccess} />;
    }
    if (pageType === LoginPageTypeEnum.feishu) {
      return <FeishuForm setPageType={setPageType} lastRoute={safeLastRoute || "/"} />;
    }
    if (pageType === LoginPageTypeEnum.forgot) {
      return <ForgetPasswordForm setPageType={setPageType} />;
    }
    return <LoginForm setPageType={setPageType} onSuccess={loginSuccess} />;
  }, [pageType, loginSuccess, safeLastRoute]);

  return (
    <main className={styles.page}>
      <Head><title>{titles[pageType]} · 伯仁</title></Head>
      <BoreCompanion />
      <header className={styles.brand}>
        <img src="/icon/logo.svg" alt="" width="38" height="38" />
        <strong>伯仁</strong><span>Bore Agent</span>
      </header>
      <section className={styles.panel} aria-labelledby="auth-title">
        <h1 id="auth-title">{titles[pageType]}</h1>
        {DynamicComponent}
      </section>
    </main>
  );
};

export default Login;
