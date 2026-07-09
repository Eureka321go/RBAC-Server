<template>
  <main
    class="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-900 px-4"
  >
    <!-- 背景渐变与光晕 -->
    <div class="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950"></div>
    <div class="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl"></div>
    <div class="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl"></div>
    <div class="relative z-10 w-full max-w-sm">
      <RouterView />
    </div>
  </main>
</template>
