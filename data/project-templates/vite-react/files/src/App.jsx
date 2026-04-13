import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: "Sora, sans-serif", padding: 48 }}>
      <h1>欢迎来到 AI Studio（Vite + React）</h1>
      <p>这是一个 Vite 风格 React 模板项目。</p>
      <button onClick={() => setCount((c) => c + 1)}>Count: {count}</button>
    </main>
  );
}
