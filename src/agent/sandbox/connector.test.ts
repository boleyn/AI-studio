import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSandbox } from "./index";

describe("local connector sandbox end-to-end", () => {
  test("reads, writes, lists and executes commands against mounted local directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-connector-e2e-"));
    const port = 18787 + Math.floor(Math.random() * 1000);
    const token = "test-connector-secret";

    const server = spawn("bun", [path.resolve("projects/agent-connector/server.ts")], {
      env: {
        ...process.env,
        AISTUDIO_CONNECTOR_PORT: String(port),
        AISTUDIO_CONNECTOR_ROOT: root,
        AISTUDIO_CONNECTOR_TOKEN: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const url = `http://127.0.0.1:${port}`;
    try {
      // 等待 connector 服务就绪
      let ready = false;
      for (let i = 0; i < 30; i += 1) {
        try {
          const resp = await fetch(`${url}/health`);
          if (resp.ok) {
            ready = true;
            break;
          }
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(ready).toBe(true);

      const sandbox = await createSandbox({
        workspaceKey: "local-mount",
        kind: "connector",
        connector: { url, token },
      });

      await sandbox.fs.writeFile("/hello.txt", "mounted-from-host\n");
      expect(fs.readFileSync(path.join(root, "hello.txt"), "utf8")).toBe("mounted-from-host\n");
      expect(await sandbox.fs.readText("/hello.txt")).toBe("mounted-from-host\n");

      const entries = await sandbox.fs.readdir("/");
      expect(entries.some((e) => e.name === "hello.txt")).toBe(true);

      const execRes = await sandbox.exec("cat hello.txt");
      expect(execRes.code).toBe(0);
      expect(execRes.stdout.trim()).toBe("mounted-from-host");
    } finally {
      server.kill("SIGKILL");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
