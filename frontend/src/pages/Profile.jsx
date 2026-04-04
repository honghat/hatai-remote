import { useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import api from '../api'
import { 
  User, Mail, Lock, Camera, Save, CheckCircle2, 
  AlertCircle, Loader2, Shield, Clock, Terminal, Zap, Sparkles
} from 'lucide-react'

export default function Profile() {
  const { user, login } = useAuth()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [formData, setFormData] = useState({
    full_name: user?.full_name || '',
    email: user?.email || '',
    password: '',
    confirm_password: ''
  })
  
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const fileInputRef = useRef(null)

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleUpdateProfile = async (e) => {
    e.preventDefault()
    if (formData.password && formData.password !== formData.confirm_password) {
      setMessage({ type: 'error', text: 'Mật khẩu xác nhận không khớp' })
      return
    }

    setLoading(true)
    setMessage({ type: '', text: '' })
    
    try {
      const updateData = {
        full_name: formData.full_name,
        email: formData.email,
      }
      if (formData.password) updateData.password = formData.password

      const resp = await api.put('/auth/profile', updateData)
      
      // Update local auth context (the token stays same, but user data might change)
      // Since our login() function in AuthContext usually takes credentials or sets local user,
      // we might need a refresh logic. For now, let's just update the local storage user object.
      const updatedUser = { ...user, ...resp.data.user }
      localStorage.setItem('hatai_user', JSON.stringify(updatedUser))
      // Force context update by re-assigning (this depends on your AuthContext implementation)
      // Most implementation have a reload/setUser method.
      
      setMessage({ type: 'success', text: 'Thông tin hồ sơ đã được cập nhật!' })
      setFormData(prev => ({ ...prev, password: '', confirm_password: '' }))
      
      // Reload page to reflect changes globally if state sync is slow
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'Lỗi cập nhật hồ sơ' })
    } finally {
      setLoading(false)
    }
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const data = new FormData()
    data.append('file', file)

    try {
      const resp = await api.post('/auth/avatar', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      
      const updatedUser = { ...user, avatar_url: resp.data.avatar_url }
      localStorage.setItem('hatai_user', JSON.stringify(updatedUser))
      
      setMessage({ type: 'success', text: 'Hình đại diện đã được cập nhật!' })
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      setMessage({ type: 'error', text: 'Lỗi tải ảnh lên' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-light-50 dark:bg-dark-950 p-6 md:p-12 custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-12">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6 animate-fade-in">
          <div className="relative group">
            <div 
              onClick={handleAvatarClick}
              className="w-32 h-32 rounded-[40px] bg-gradient-to-br from-primary-500 to-indigo-600 p-1 cursor-pointer shadow-2xl transition-transform hover:scale-105 active:scale-95 overflow-hidden"
            >
              <div className="w-full h-full rounded-[38px] bg-white dark:bg-dark-900 flex items-center justify-center overflow-hidden relative">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User size={48} className="text-light-300 dark:text-slate-700" />
                )}
                
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  {uploading ? <Loader2 size={24} className="text-white animate-spin" /> : <Camera size={24} className="text-white" />}
                </div>
              </div>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept="image/*" 
            />
            <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-primary-600 rounded-2xl flex items-center justify-center text-white shadow-xl border-4 border-light-50 dark:border-dark-950 group-hover:rotate-12 transition-transform">
              <Sparkles size={16} />
            </div>
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-light-900 dark:text-white tracking-tighter">
                Hồ sơ Cá nhân
              </h1>
              <div className="px-3 py-1 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-full text-[10px] font-black uppercase tracking-widest border border-primary-500/20">
                {user?.role?.display_name || 'Hạng mục User'}
              </div>
            </div>
            <p className="text-light-500 dark:text-slate-500 font-medium text-sm leading-relaxed">
              Chào mừng, <span className="text-primary-600 font-bold">{user?.username}</span>! Quản lý thông tin tài khoản và cấu hình giao diện của riêng bạn.
            </p>
          </div>
        </div>

        {/* Status Messages */}
        {message.text && (
          <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-red-500/10 text-red-600 border border-red-500/20'}`}>
            {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span className="text-sm font-bold">{message.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Edit Form */}
          <div className="lg:col-span-2 space-y-8">
            <div className={`p-8 rounded-[40px] border ${isDark ? 'bg-dark-900/40 border-white/5 shadow-2xl' : 'bg-white border-light-200 shadow-xl shadow-light-200/50'}`}>
              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500 px-1">Tên Hiển Thị</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                      <input 
                        name="full_name"
                        value={formData.full_name} 
                        onChange={handleChange}
                        className="w-full bg-light-50 dark:bg-dark-950/50 border-none rounded-2xl pl-12 pr-5 py-4 text-sm font-bold focus:ring-4 focus:ring-primary-500/10 transition-all outline-none" 
                        placeholder="Họ và tên của bạn" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500 px-1">Địa chỉ Email</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                      <input 
                        name="email"
                        type="email"
                        value={formData.email} 
                        onChange={handleChange}
                        className="w-full bg-light-50 dark:bg-dark-950/50 border-none rounded-2xl pl-12 pr-5 py-4 text-sm font-bold focus:ring-4 focus:ring-primary-500/10 transition-all outline-none" 
                        placeholder="email@example.com" 
                      />
                    </div>
                  </div>
                </div>

                <div className="h-px bg-light-100 dark:bg-white/5 my-4" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500 px-1">Đổi Mật Khẩu</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                      <input 
                        name="password"
                        type="password"
                        value={formData.password} 
                        onChange={handleChange}
                        className="w-full bg-light-50 dark:bg-dark-950/50 border-none rounded-2xl pl-12 pr-5 py-4 text-sm font-bold focus:ring-4 focus:ring-primary-500/10 transition-all outline-none" 
                        placeholder="Để trống nếu không đổi" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500 px-1">Xác Nhận Mật Khẩu</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                      <input 
                        name="confirm_password"
                        type="password"
                        value={formData.confirm_password} 
                        onChange={handleChange}
                        className="w-full bg-light-50 dark:bg-dark-950/50 border-none rounded-2xl pl-12 pr-5 py-4 text-sm font-bold focus:ring-4 focus:ring-primary-500/10 transition-all outline-none" 
                        placeholder="Nhập lại mật khẩu mới" 
                      />
                    </div>
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 py-4 bg-primary-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  Lưu thay đổi hồ sơ
                </button>
              </form>
            </div>
          </div>

          {/* Sidebar Stats & Info */}
          <div className="space-y-8">
            <div className={`p-8 rounded-[40px] border ${isDark ? 'bg-dark-900/40 border-white/5' : 'bg-white border-light-200'}`}>
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-light-400 dark:text-slate-600 mb-6">Thông tin chi tiết</h3>
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl"><Shield size={18} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase opacity-40">Phân quyền</p>
                    <p className="text-sm font-black text-light-900 dark:text-white">{user?.role?.display_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl"><Clock size={18} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase opacity-40">Tham gia lúc</p>
                    <p className="text-sm font-black text-light-900 dark:text-white">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
