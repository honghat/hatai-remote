import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem('hatai_user')
      return u ? JSON.parse(u) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(false)

  const login = async (username, password) => {
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username, password })
      localStorage.setItem('hatai_token', data.access_token)
      localStorage.setItem('hatai_user', JSON.stringify(data.user))
      setUser(data.user)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.response?.data?.detail || 'Đăng nhập thất bại' }
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('hatai_token')
    localStorage.removeItem('hatai_user')
    setUser(null)
  }

  const isAdmin = () => user?.role?.name === 'admin' || user?.role_id === 1

  /**
   * Kiểm tra user có quyền cụ thể không.
   * Admin luôn có full quyền.
   * @param {string} resource - Module: "users", "erp", "accounting", "chat", ...
   * @param {string} action - "read", "write", "manage", "execute", "approve"
   */
  const hasPermission = useCallback((resource, action) => {
    if (!user) return false
    if (!user.permissions) return false
    return user.permissions.some(
      p => p.resource === resource && (p.action === action || p.action === 'manage')
    )
  }, [user])

  /**
   * Kiểm tra user có ít nhất 1 trong các quyền.
   * @param {Array<[string, string]>} perms - Mảng [resource, action]
   */
  const hasAnyPermission = useCallback((...perms) => {
    if (!user) return false
    if (user.role?.name === 'admin') return true
    return perms.some(([resource, action]) => hasPermission(resource, action))
  }, [user, hasPermission])

  // Refresh user data on mount if token exists
  useEffect(() => {
    const token = localStorage.getItem('hatai_token')
    if (token && user) {
      api.get('/auth/me').then(({ data }) => {
        localStorage.setItem('hatai_user', JSON.stringify(data))
        setUser(data)
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin, hasPermission, hasAnyPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
