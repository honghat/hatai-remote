import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

export const codeApi = axios.create({
  baseURL: '/code-api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token to both
const attachToken = (config) => {
  const token = localStorage.getItem('hatai_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}

api.interceptors.request.use(attachToken)
codeApi.interceptors.request.use(attachToken)

// Auto-logout on 401 for both
const handleLogout = (err) => {
  if (err.response?.status === 401) {
    localStorage.removeItem('hatai_token')
    localStorage.removeItem('hatai_user')
    window.location.href = '/login'
  }
  return Promise.reject(err)
}

api.interceptors.response.use((res) => res, handleLogout)
codeApi.interceptors.response.use((res) => res, handleLogout)

export default api
