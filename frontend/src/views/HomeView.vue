<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import request from '@/api/request'

const { t } = useI18n()

// 一个最小的连通性验证：调用后端 /api/ping，业务页面后续再实现。
const status = ref<string>(t('home.notChecked'))
const detail = ref<string>('')

async function checkBackend() {
  status.value = t('home.checking')
  detail.value = ''
  try {
    const res: unknown = await request.get('/ping')
    status.value = t('home.connected')
    detail.value = JSON.stringify(res, null, 2)
  } catch (e: unknown) {
    status.value = t('home.disconnected')
    detail.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main class="home">
    <h1>{{ t('home.title') }}</h1>
    <p class="sub">{{ t('home.sub') }}</p>

    <button @click="checkBackend">{{ t('home.check') }}</button>
    <p class="status">{{ status }}</p>
    <pre v-if="detail" class="detail">{{ detail }}</pre>
  </main>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 4rem auto;
  padding: 0 1rem;
  font-family: system-ui, sans-serif;
}
h1 {
  font-size: 1.6rem;
  margin-bottom: 0.5rem;
}
.sub {
  color: #888;
  margin-bottom: 1.5rem;
}
button {
  padding: 0.5rem 1rem;
  cursor: pointer;
}
.status {
  margin-top: 1rem;
  font-weight: 600;
}
.detail {
  margin-top: 0.5rem;
  padding: 1rem;
  background: rgba(128, 128, 128, 0.1);
  border-radius: 6px;
  overflow-x: auto;
}
</style>
