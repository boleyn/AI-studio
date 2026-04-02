export type SandpackFileMap = Record<string, { code: string }>;
export const DEFAULT_REACT_TEMPLATE_DEPENDENCIES: Record<string, string> = {
  react: "^18.2.0",
  "react-dom": "^18.2.0",
};

export const DEFAULT_REACT_TEMPLATE_FILES: SandpackFileMap = {
  "/package.json": {
    code: `{
  "name": "ai-studio-app",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
`,
  },
  "/App.js": {
    code: `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app">
      <header>
        <p className="badge">React Starter</p>
        <h1>欢迎来到 AI Studio</h1>
        <p className="subtle">从这里开始构建你的前端页面。</p>
      </header>
      <section className="card">
        <h2>交互示例</h2>
        <p>点击计数器：{count}</p>
        <button onClick={() => setCount((prev) => prev + 1)}>Click me</button>
      </section>
    </main>
  );
}
`,
  },
  "/index.js": {
    code: `import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
  },
  "/styles.css": {
    code: `.app {
  font-family: "Sora", sans-serif;
  color: #f7f5ff;
  background: radial-gradient(circle at top, #3b2f6d, #101018 65%);
  min-height: 100vh;
  padding: 64px;
}

h1 {
  font-size: 40px;
  letter-spacing: -0.02em;
  margin: 16px 0;
}

p {
  opacity: 0.7;
  margin-top: 12px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #f7f5ff;
}

.subtle {
  opacity: 0.75;
  max-width: 520px;
}

.card {
  margin-top: 32px;
  padding: 24px;
  border-radius: 16px;
  background: rgba(16, 16, 24, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 60px rgba(8, 8, 16, 0.3);
}

button {
  margin-top: 12px;
  border: 0;
  padding: 10px 16px;
  border-radius: 999px;
  background: #f7f5ff;
  color: #111018;
  font-weight: 600;
  cursor: pointer;
}

h2 {
  margin: 0 0 8px;
}
`,
  },
  "/public/index.html": {
    code: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Studio App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  },
};

const ROOT_APP_FILES = ["/App.js", "/App.jsx", "/App.tsx", "/App.ts"] as const;
const ROOT_ENTRY_FILES = ["/index.js", "/index.jsx", "/index.tsx", "/index.ts"] as const;
const ROOT_STYLE_FILES = ["/styles.css", "/index.css"] as const;
const SRC_APP_FILES = ["/src/App.js", "/src/App.jsx", "/src/App.tsx", "/src/App.ts"] as const;
const SRC_ENTRY_FILES = ["/src/main.js", "/src/main.jsx", "/src/main.tsx", "/src/main.ts"] as const;
const SRC_STYLE_FILES = ["/src/styles.css", "/src/index.css"] as const;

const VITE_SPECIFIC_FILES = [
  "/index.html",
  "/vite.config.js",
  "/vite.config.ts",
  "/vite-env.d.ts",
  "/tsconfig.node.json",
] as const;

const DEFAULT_PACKAGE_JSON_CONTENT = DEFAULT_REACT_TEMPLATE_FILES["/package.json"].code;

const findExisting = (files: SandpackFileMap, paths: readonly string[]): string | null => {
  for (const path of paths) {
    if (files[path]) return path;
  }
  return null;
};

export const normalizeSandpackReactTemplateFiles = (
  input: SandpackFileMap
): { files: SandpackFileMap; changed: boolean } => {
  const files: SandpackFileMap = { ...input };
  let changed = false;

  const rootAppPath = findExisting(files, ROOT_APP_FILES);
  const rootEntryPath = findExisting(files, ROOT_ENTRY_FILES);
  const rootStylePath = findExisting(files, ROOT_STYLE_FILES);
  const srcAppPath = findExisting(files, SRC_APP_FILES);
  const srcEntryPath = findExisting(files, SRC_ENTRY_FILES);
  const srcStylePath = findExisting(files, SRC_STYLE_FILES);
  const hasPublicIndex = Boolean(files["/public/index.html"]);

  // Migrate src-style scaffold to root-style React scaffold if needed.
  if (!rootAppPath && srcAppPath) {
    files["/App.js"] = { code: files[srcAppPath].code };
    changed = true;
  }
  if (!rootEntryPath && srcEntryPath) {
    files["/index.js"] = { code: files[srcEntryPath].code };
    changed = true;
  }
  if (!rootStylePath && srcStylePath) {
    files["/styles.css"] = { code: files[srcStylePath].code };
    changed = true;
  }

  if (!files["/App.js"] && rootAppPath && rootAppPath !== "/App.js") {
    files["/App.js"] = { code: files[rootAppPath].code };
    changed = true;
  }
  if (!files["/index.js"] && rootEntryPath && rootEntryPath !== "/index.js") {
    files["/index.js"] = { code: files[rootEntryPath].code };
    changed = true;
  }
  if (!files["/styles.css"] && rootStylePath && rootStylePath !== "/styles.css") {
    files["/styles.css"] = { code: files[rootStylePath].code };
    changed = true;
  }

  if (!files["/App.js"]) {
    files["/App.js"] = DEFAULT_REACT_TEMPLATE_FILES["/App.js"];
    changed = true;
  }
  if (!files["/index.js"]) {
    files["/index.js"] = DEFAULT_REACT_TEMPLATE_FILES["/index.js"];
    changed = true;
  }
  if (!files["/styles.css"]) {
    files["/styles.css"] = DEFAULT_REACT_TEMPLATE_FILES["/styles.css"];
    changed = true;
  }
  if (!files["/package.json"]) {
    files["/package.json"] = { code: DEFAULT_PACKAGE_JSON_CONTENT };
    changed = true;
  }
  if (!hasPublicIndex) {
    files["/public/index.html"] = DEFAULT_REACT_TEMPLATE_FILES["/public/index.html"];
    changed = true;
  }

  // Keep canonical root React scaffold and remove Vite/src duplicates.
  for (const path of [...SRC_APP_FILES, ...SRC_ENTRY_FILES, ...SRC_STYLE_FILES, ...VITE_SPECIFIC_FILES]) {
    if (files[path]) {
      delete files[path];
      changed = true;
    }
  }

  for (const legacyPath of ["/App.jsx", "/App.ts", "/App.tsx", "/index.jsx", "/index.ts", "/index.tsx", "/index.css"] as const) {
    if (files[legacyPath]) {
      delete files[legacyPath];
      changed = true;
    }
  }

  return { files, changed };
};
