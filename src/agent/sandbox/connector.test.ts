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

    const binary = process.env.CONNECTOR_TEST_BINARY;
    const server = spawn(binary ? path.resolve(binary) : "bun", binary ? [] : [path.resolve("projects/agent-connector/server.ts")], {
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

      fs.writeFileSync(path.join(root, "existing.txt"), "keep private baseline");
      const unauthorized = await fetch(`${url}/rpc`, { method: "POST", body: JSON.stringify({ protocolVersion: 1, op: "stat", path: "/" }) });
      expect(unauthorized.status).toBe(401);
      const incompatible = await fetch(`${url}/rpc`, { method: "POST", headers: { "x-aistudio-connector-token": token }, body: JSON.stringify({ protocolVersion: 99, op: "stat", path: "/" }) });
      expect(incompatible.status).toBe(400);
      const sandbox = await createSandbox({
        workspaceKey: "local-mount",
        kind: "connector",
        runtimeFiles: { "/skills/demo/SKILL.md": { code: "---\nname: demo\ndescription: Demo\n---\nInstructions" } },
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
      expect(await sandbox.fs.readText("/skills/demo/SKILL.md")).toContain("Instructions");
      const generated = await sandbox.exec("printf 'command artifact' > generated.txt");
      expect(generated.code).toBe(0);
      const exported = await sandbox.exportProjectFiles();
      expect(exported["/generated.txt"].code).toBe("command artifact");
      expect(exported["/hello.txt"].code).toBe("mounted-from-host\n");
      expect(exported["/existing.txt"]).toBeUndefined();
      expect(exported["/skills/demo/SKILL.md"]).toBeUndefined();
      const longOutput = await sandbox.exec("printf START; head -c 250000 /dev/zero | tr '\\0' x; printf MIDDLE_MARKER; head -c 250000 /dev/zero | tr '\\0' y; printf END");
      expect(longOutput.code).toBe(0);
      expect(longOutput.stdout.length).toBeLessThan(12000);
      expect(longOutput.stdout).not.toContain("MIDDLE_MARKER");
      const archive = longOutput.stdout.match(/\/.aistudio\/context\/exec-[a-f0-9-]+\.stdout\.txt/)?.[0];
      expect(archive).toBeDefined();
      const recovered = await sandbox.fs.readText(archive!);
      expect(recovered).toBe("START" + "x".repeat(250000) + "MIDDLE_MARKER" + "y".repeat(250000) + "END");
      const abort = new AbortController();
      const running = sandbox.exec("sleep 2; printf late > cancelled.txt", { signal: abort.signal });
      await new Promise((resolve) => setTimeout(resolve, 100));
      abort.abort();
      expect((await running).code).not.toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      expect(fs.existsSync(path.join(root, "cancelled.txt"))).toBe(false);
      fs.symlinkSync(os.tmpdir(), path.join(root, "outside"));
      await expect(sandbox.fs.writeFile("/outside/connector-escape-fixture.txt", "must not write")).rejects.toThrow("path_outside_root");
    } finally {
      server.kill("SIGKILL");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
