<script setup>
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <main class="app">
    <h1>欢迎来到 AI Studio（Vue）</h1>
    <p>这是一个 Vue 模板项目。</p>
    <button @click="count += 1">Count: {{ count }}</button>
  </main>
</template>

<style scoped>
.app {
  font-family: "Sora", sans-serif;
  padding: 48px;
  color: #1f2937;
}
button {
  margin-top: 12px;
  border: 0;
  border-radius: 10px;
  padding: 10px 14px;
  background: #111827;
  color: #fff;
  cursor: pointer;
}
</style>
