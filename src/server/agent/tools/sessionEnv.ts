import { promises as fs } from "fs";
import path from "path";

const SESSION_ENV_ALLOWLIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "SHELL",
  "NPM_CONFIG_REGISTRY",
  "NPM_REGISTRY",
  "npm_config_registry",
  "PIP_INDEX_URL",
  "PIP_TRUSTED_HOST",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

const toSafeSessionId = (raw?: string) => {
  const value = (raw || "default").trim();
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return normalized || "default";
};

export const buildSessionIsolatedEnv = async (input: {
  sessionId?: string;
  workspaceRoot?: string;
}) => {
  const workspaceRoot = path.resolve(input.workspaceRoot || process.cwd());
  const safeSessionId = toSafeSessionId(input.sessionId);
  const sessionHome = path.join(workspaceRoot, ".aistudio", "sessions", safeSessionId);
  const sessionTmp = path.join(sessionHome, "tmp");

  await fs.mkdir(sessionTmp, { recursive: true });

  const env = {} as NodeJS.ProcessEnv;
  for (const key of SESSION_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string" && value) {
      env[key] = value;
    }
  }

  env.HOME = sessionHome;
  env.TMPDIR = sessionTmp;
  env.TMP = sessionTmp;
  env.TEMP = sessionTmp;
  env.AISTUDIO_SESSION_ID = safeSessionId;

  return env;
};
