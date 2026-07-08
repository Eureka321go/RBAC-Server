import axios from 'axios'

// axios 基础实例：baseURL 走 /api，开发环境由 Vite 代理转发到后端 8080。
const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// 请求拦截器：后续在此注入 token 等。
request.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error),
)

// 响应拦截器：统一剥离后端 { code, message, data } 结构，后续在此做错误处理。
request.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error),
)

export default request
