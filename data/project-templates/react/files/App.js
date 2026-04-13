import { useState } from "react";

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
