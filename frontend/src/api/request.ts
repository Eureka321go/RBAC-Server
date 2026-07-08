import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from '@/utils/token'
import type { LoginResult } from '@/types/auth'

interface ApiResult<T> {
  code: number
  message: string
  data: T
}

// axios 基础实例：baseURL 走 /api，开发环境由 Vite 代理转发到后端 8080。
const instance = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// 请求拦截器：注入 Bearer Token。
instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── 401 刷新 Token 单飞 + 重放 ──
let refreshing = false
let pendingQueue: Array<(token: string | null) => void> = []

function flushQueue(token: string | null) {
  pendingQueue.forEach((cb) => cb(token))
  pendingQueue = []
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null
  try {
    // 用裸 axios 避免再次进入拦截器造成递归
    const resp = await axios.post<ApiResult<LoginResult>>('/api/auth/refresh-token', { refreshToken })
    const data = resp.data.data
    setAccessToken(data.accessToken)
    setRefreshToken(data.refreshToken)
    return data.accessToken
  } catch {
    return null
  }
}

function redirectToLogin() {
  clearTokens()
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

// 响应拦截器：剥离 { code, message, data }，统一错误处理。
instance.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResult<unknown>
    if (body && typeof body.code === 'number') {
      if (body.code === 200) {
        return body.data
      }
      ElMessage.error(body.message || '请求失败')
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    return response.data
  },
  async (error) => {
    const response = error.response
    const config = error.config as AxiosRequestConfig & { _retry?: boolean }
    if (!response) {
      ElMessage.error('网络异常，请稍后重试')
      return Promise.reject(error)
    }

    const status = response.status
    const url = config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh-token')

    // 401：尝试刷新 Token 并重放（403 不重试）
    if (status === 401 && !isAuthEndpoint && !config._retry) {
      if (refreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push((token) => {
            if (token) {
              config._retry = true
              config.headers = { ...config.headers, Authorization: `Bearer ${token}` }
              resolve(instance(config))
            } else {
              reject(error)
            }
          })
        })
      }

      refreshing = true
      const newToken = await doRefresh()
      refreshing = false
      flushQueue(newToken)

      if (newToken) {
        config._retry = true
        config.headers = { ...config.headers, Authorization: `Bearer ${newToken}` }
        return instance(config)
      }
      ElMessage.error('登录已失效，请重新登录')
      redirectToLogin()
      return Promise.reject(error)
    }

    if (status === 403) {
      ElMessage.error('无权限访问')
      return Promise.reject(error)
    }

    const message = (response.data as ApiResult<unknown>)?.message || `请求错误（${status}）`
    ElMessage.error(message)
    return Promise.reject(error)
  },
)

// 类型化包装：直接返回后端 data 部分。
const request = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return instance.get(url, config) as unknown as Promise<T>
  },
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.post(url, data, config) as unknown as Promise<T>
  },
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.put(url, data, config) as unknown as Promise<T>
  },
  delete<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return instance.delete(url, config) as unknown as Promise<T>
  },
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.patch(url, data, config) as unknown as Promise<T>
  },
}

export default request
