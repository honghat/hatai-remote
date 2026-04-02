import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Bot, Eye, EyeOff, LogIn, Loader2 } from 'lucide-react'

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const res = await login(form.username, form.password)
    if (res.success) navigate('/chat')
    else setError(res.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-light-50 dark:bg-dark-950">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-600/10 dark:bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-200 dark:bg-indigo-900/20 rounded-full blur-3xl opacity-50" />
      </div>

      <div className="glass-card p-8 w-full max-w-md relative animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-primary-600 dark:bg-primary-600/20 border border-primary-500/20 dark:border-primary-500/30 mb-6 shadow-2xl shadow-primary-500/20">
            <Bot size={40} className="text-white dark:text-primary-400" />
          </div>
          <h1 className="text-3xl font-black text-light-900 dark:text-white tracking-tight">HatAI Remote</h1>
          <p className="text-light-500 dark:text-slate-500 text-sm mt-2 font-medium">Điều khiển AI từ xa · Llama-cpp-python</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-light-700 dark:text-slate-300 mb-1.5">Tên đăng nhập</label>
            <input
              id="username"
              type="text"
              className="input-field"
              placeholder="username"
              value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-light-700 dark:text-slate-300 mb-1.5">Mật khẩu</label>
            <div className="relative">
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                className="input-field pr-12"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                required
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-light-500 dark:text-slate-500 hover:text-light-700 dark:hover:text-slate-300 transition-colors"
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700/50 rounded-lg px-4 py-3 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            id="login-btn"
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-3.5 text-base font-bold shadow-lg shadow-primary-600/20 active:scale-95 transition-all"
          >
            {loading ? (
              <><Loader2 size={20} className="animate-spin" /> Đang đăng nhập...</>
            ) : (
              <><LogIn size={20} /> Đăng nhập hệ thống</>
            )}
          </button>
        </form>

        <p className="text-center text-light-400 dark:text-slate-600 text-[10px] uppercase font-bold tracking-[0.2em] mt-10">
          Powered by llama-cpp-python · Qwen3-4B
        </p>
      </div>
    </div>
  )
}
