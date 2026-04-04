import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  Settings, Lock, Server, Database, Cpu, Globe, Shield, RefreshCw,
  CheckCircle2, AlertTriangle, Info, Bot, Sparkles, Loader2, Brain, Plus, Edit2, Trash2, X, Key
} from 'lucide-react'
import ModelStatusBadge from '../../components/ModelStatusBadge'

function InfoRow({ label, value, status }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-1 border-b border-light-50 dark:border-slate-800/40 last:border-0">
      <span className="text-sm text-light-500 dark:text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        {status === 'ok' && <CheckCircle2 size={14} className="text-green-500" />}
        {status === 'warn' && <AlertTriangle size={14} className="text-amber-500" />}
        <span className="text-sm font-bold text-light-900 dark:text-white">{value}</span>
      </div>
    </div>
  )
}

function SettingsCard({ icon: Icon, title, children, color = 'from-slate-500 to-slate-600' }) {
  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-light-100 dark:border-slate-800/50">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg transform hover:rotate-6 transition-transform`}>
          <Icon size={16} className="text-white" />
        </div>
        <h3 className="text-sm font-extrabold text-light-900 dark:text-white tracking-tight">{title}</h3>
      </div>
      <div className="px-5 py-3">
        {children}
      </div>
    </div>
  )
}

export default function AdminSettings() {
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState(null)
  const [status, setStatus] = useState(null)
  
  // Model Parameters (persisted to localStorage for Chat module)
  const [temp, setTemp] = useState(() => Number(localStorage.getItem('hatai_temp')) || 0.7)
  const [tokens, setTokens] = useState(() => Number(localStorage.getItem('hatai_tokens')) || 4096)

  // DB-based Providers
  const [providers, setProviders] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState(null)
  const [formData, setFormData] = useState({
    name: '', provider_type: 'openai', model_name: '', api_base: '', api_key: ''
  })
  
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(null)

  const fetchStatus = async () => {
    try {
      const { data } = await api.get('/ai/status')
      setStatus(data)
    } catch { setStatus(null) }
  }

  const fetchHealth = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/health')
      setHealth(data)
    } catch {}
    setLoading(false)
  }

  const fetchProviders = async () => {
    try {
      const { data } = await api.get('/ai/providers')
      setProviders(data)
    } catch {}
  }

  useEffect(() => { 
    fetchHealth()
    fetchStatus()
    fetchProviders()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [])

  const updateTemp = (v) => {
    setTemp(v)
    localStorage.setItem('hatai_temp', v)
  }

  const updateTokens = (v) => {
    setTokens(v)
    localStorage.setItem('hatai_tokens', v)
  }

  const handleOpenAdd = () => {
    setEditingProvider(null)
    setFormData({ name: '', provider_type: 'openai', model_name: '', api_base: '', api_key: '' })
    setIsModalOpen(true)
  }

  const handleOpenEdit = (p) => {
    setEditingProvider(p)
    setFormData({ 
      name: p.name, 
      provider_type: p.provider_type, 
      model_name: p.model_name, 
      api_base: p.api_base || '', 
      api_key: p.api_key || '' 
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Xác nhận xóa kết nối mô hình này?')) return
    try {
      await api.delete(`/ai/providers/${id}`)
      fetchProviders()
    } catch (e) { alert(e.message) }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editingProvider) {
        await api.put(`/ai/providers/${editingProvider.id}`, formData)
      } else {
        await api.post('/ai/providers', formData)
      }
      setIsModalOpen(false)
      fetchProviders()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  const handleActivate = async (id) => {
    setActivating(id)
    try {
      await api.post(`/ai/providers/${id}/activate`)
      fetchProviders()
      fetchStatus()
    } catch (e) { alert(e.message) }
    setActivating(null)
  }

  if (!isAdmin()) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Lock size={48} className="mx-auto text-light-300 dark:text-slate-600 mb-4" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-light-50 dark:bg-dark-950">
      {/* Header */}
      <div className="px-8 py-6 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-dark-950/50 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center shadow-2xl border border-white/10">
              <Settings size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-light-900 dark:text-white tracking-tighter">
                Quản trị Hệ thống
              </h1>
              <p className="text-[10px] text-light-500 dark:text-slate-500 mt-1 uppercase font-black tracking-widest opacity-60">
                Tài nguyên AI & Hạ tầng cốt lõi
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-500 shadow-lg shadow-primary-500/20 transition-all active:scale-95"
             >
                <Plus size={14} /> Thêm kết nối
             </button>
             <button
                onClick={() => { fetchHealth(); fetchStatus(); fetchProviders(); }}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-dark-900 text-light-700 dark:text-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-light-100 dark:hover:bg-dark-800 border border-light-200 dark:border-slate-800 shadow-sm transition-all"
             >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
             </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-7xl mx-auto p-8 space-y-10">
          
          {/* Intelligence Engine Management Table */}
          <section className="space-y-6">
             <div className="flex items-center justify-between px-2">
                <div>
                   <h3 className="text-xl font-black text-light-900 dark:text-white flex items-center gap-3 tracking-tighter">
                      <div className="w-1.5 h-6 bg-primary-600 rounded-full" />
                      Quản lý kết nối mô hình
                   </h3>
                   <p className="text-[10px] text-light-500 dark:text-slate-500 font-bold uppercase tracking-[0.2em] mt-1.5 opacity-70">Cấu hình các nhà cung cấp AI</p>
                </div>
                <div className="hidden md:flex items-center gap-8 bg-white dark:bg-dark-900/50 p-4 rounded-[24px] border border-light-200 dark:border-slate-800/60 shadow-sm">
                   <div className="flex flex-col items-start px-2 border-r border-light-100 dark:border-slate-800">
                      <span className="text-[9px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-2">Temperature (Global)</span>
                      <div className="flex items-center gap-4">
                        <input type="range" min="0" max="1" step="0.1" value={temp} onChange={e => updateTemp(+e.target.value)} className="w-32 accent-primary-600 cursor-pointer h-1.5 bg-light-100 dark:bg-dark-800 rounded-full appearance-none" />
                        <span className="text-xs font-black text-primary-600 w-6">{temp}</span>
                      </div>
                   </div>
                   <div className="flex flex-col items-start px-2">
                      <span className="text-[9px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-2">Context Limit</span>
                      <div className="flex items-center gap-4">
                        <input type="range" min="1024" max="128000" step="1024" value={tokens} onChange={e => updateTokens(+e.target.value)} className="w-32 accent-primary-600 cursor-pointer h-1.5 bg-light-100 dark:bg-dark-800 rounded-full appearance-none" />
                        <span className="text-[10px] font-black text-primary-600">{Math.floor(tokens / 1024)}K</span>
                      </div>
                   </div>
                </div>
             </div>

             <div className="bg-white dark:bg-dark-900/40 border border-light-200 dark:border-slate-800/60 rounded-[32px] overflow-hidden shadow-2xl backdrop-blur-sm">
                <table className="w-full text-left border-collapse">
                   <thead>
                      <tr className="bg-light-50/50 dark:bg-dark-950/40 border-b border-light-200 dark:border-slate-800/60">
                         <th className="px-8 py-5 text-[10px] font-black text-light-500 dark:text-slate-500 uppercase tracking-[0.25em]">Tên / Loại</th>
                         <th className="px-8 py-5 text-[10px] font-black text-light-500 dark:text-slate-500 uppercase tracking-[0.25em]">Mô hình trí tuệ</th>
                         <th className="px-8 py-5 text-[10px] font-black text-light-500 dark:text-slate-500 uppercase tracking-[0.25em]">Trạng thái đồng bộ</th>
                         <th className="px-8 py-5 text-[10px] font-black text-light-500 dark:text-slate-500 uppercase tracking-[0.25em] text-right pr-12">Thao tác điều khiển</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-light-200 dark:divide-slate-800/40">
                      {providers.map(p => (
                        <tr key={p.id} className={`transition-all duration-300 ${p.is_active ? 'bg-primary-500/10 dark:bg-primary-500/5' : 'hover:bg-light-50 dark:hover:bg-dark-900/40'}`}>
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-white dark:bg-dark-900 border border-light-100 dark:border-slate-800 flex items-center justify-center shadow-sm">
                                {p.provider_type === 'gemini' ? <Sparkles size={18} className="text-primary-500" /> : 
                                 p.provider_type === 'ollama' ? <Cpu size={18} className="text-orange-500" /> :
                                 p.provider_type === 'deepseek' ? <Brain size={18} className="text-blue-500" /> :
                                 <Globe size={18} className="text-emerald-500" />}
                              </div>
                              <div>
                                <div className="text-[13px] font-black text-light-900 dark:text-white leading-tight flex items-center gap-2">
                                  {p.name}
                                  {p.is_active && <div className="w-1.5 h-1.5 rounded-full bg-primary-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
                                </div>
                                <div className="text-[9px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest mt-1 opacity-60">
                                  {p.provider_type.toUpperCase()} CONNECTION
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="text-[12px] font-black text-light-700 dark:text-slate-300 tracking-tight">{p.model_name}</div>
                            {p.api_base && <div className="text-[10px] font-mono text-light-400 dark:text-slate-600 mt-1 truncate max-w-[200px]">{p.api_base}</div>}
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-2">
                               <div className={`w-1.5 h-1.5 rounded-full ${p.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-light-300 dark:bg-slate-700'}`} />
                               <span className={`text-[10px] font-black uppercase tracking-widest ${p.is_active ? 'text-emerald-500' : 'text-light-400 dark:text-slate-600'}`}>
                                  {p.is_active ? 'Đã triển khai' : 'Chờ lệnh'}
                               </span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-right">
                             <div className="flex items-center justify-end gap-2">
                                {!p.is_active && (
                                   <button onClick={() => handleActivate(p.id)} disabled={activating === p.id}
                                      className="px-4 py-2 bg-primary-600/10 text-primary-600 hover:bg-primary-600 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                                      {activating === p.id ? 'Đang triển khai...' : 'Kích hoạt kết nối'}
                                   </button>
                                )}
                                <button onClick={() => handleOpenEdit(p)} className="p-2.5 text-light-400 dark:text-slate-500 hover:bg-light-100 dark:hover:bg-dark-800 rounded-xl transition-all">
                                   <Edit2 size={14} />
                                </button>
                                <button onClick={() => handleDelete(p.id)} className="p-2.5 text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all">
                                   <Trash2 size={14} />
                                </button>
                             </div>
                          </td>
                        </tr>
                      ))}
                      {providers.length === 0 && (
                        <tr>
                          <td colSpan="4" className="px-8 py-16 text-center text-light-400 dark:text-slate-600 text-xs font-black uppercase tracking-widest opacity-40 italic">
                             Không có nhà cung cấp AI nào được cấu hình trong workspace.
                          </td>
                        </tr>
                      )}
                   </tbody>
                </table>
             </div>
          </section>

          {/* Infrastructure Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <SettingsCard icon={Server} title="Máy chủ cốt lõi" color="from-emerald-600 to-teal-700">
                <InfoRow label="Trạng thái tín hiệu" value={health?.status === 'ok' ? 'Đang hoạt động' : 'Nguy cấp'} status={health?.status === 'ok' ? 'ok' : 'warn'} />
                <InfoRow label="Phiên bản hệ thống" value={health?.version || '1.0.0 Stable'} />
              </SettingsCard>

              <SettingsCard icon={Database} title="Hạ tầng trí tuệ" color="from-primary-600 to-indigo-700">
                <InfoRow label="Nguồn Neural hoạt động" value={status?.provider?.toUpperCase() || '—'} />
                <InfoRow label="Bộ nhớ dài hạn" value="ChromaDB Sẵn sàng" status="ok" />
              </SettingsCard>

              <SettingsCard icon={Shield} title="Neural Guard" color="from-rose-600 to-red-800">
                <InfoRow label="Lớp mã hóa" value="AES-256" status="ok" />
                <InfoRow label="Giao thức truy cập" value="RBAC Kích hoạt" />
              </SettingsCard>

              <SettingsCard icon={Info} title="Module Insights" color="from-blue-600 to-cyan-800">
                <InfoRow label="Kernel" value="FastAPI-Core" />
                <InfoRow label="UI Framework" value="React 18" />
              </SettingsCard>
          </div>
        </div>
      </div>

      {/* CRUD Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white dark:bg-dark-900 rounded-[32px] overflow-hidden shadow-2xl border border-light-200 dark:border-slate-800/60 transition-all scale-up">
            <form onSubmit={handleSave}>
              <div className="px-8 py-6 border-b border-light-100 dark:border-slate-800/60 bg-light-50/50 dark:bg-dark-950/40 flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-black text-light-900 dark:text-white tracking-tight">
                    {editingProvider ? 'Cập nhật kết nối mô hình' : 'Đăng ký Module AI mới'}
                  </h4>
                  <p className="text-[10px] text-light-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1 opacity-70">
                    Giao thức cấu hình v1.4
                  </p>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-light-400 dark:text-slate-500 hover:bg-light-100 dark:hover:bg-dark-800 rounded-xl transition-all"><X size={20} /></button>
              </div>

              <div className="p-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-light-500 dark:text-slate-500 px-1">Nhãn hiển thị</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-light-50 dark:bg-dark-950/50 border border-light-200 dark:border-slate-800/80 rounded-2xl px-5 py-3.5 text-sm font-bold text-light-900 dark:text-white outline-none focus:border-primary-500/50 transition-all"
                    placeholder="vd: Cụm DeepSeek của tôi" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-light-500 dark:text-slate-500 px-1">Cốt lõi nhà cung cấp</label>
                    <select value={formData.provider_type} onChange={e => setFormData({...formData, provider_type: e.target.value})}
                      className="w-full bg-light-50 dark:bg-dark-950/50 border border-light-200 dark:border-slate-800/80 rounded-2xl px-5 py-3.5 text-sm font-bold text-light-900 dark:text-white outline-none transition-all">
                      <option value="openai">OpenAI / Tương thích</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="ollama">Ollama Local</option>
                      <option value="deepseek">DeepSeek Official</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-light-500 dark:text-slate-500 px-1">Tên mô hình nội bộ</label>
                    <input required type="text" value={formData.model_name} onChange={e => setFormData({...formData, model_name: e.target.value})}
                      className="w-full bg-light-50 dark:bg-dark-950/50 border border-light-200 dark:border-slate-800/80 rounded-2xl px-5 py-3.5 text-sm font-bold text-light-900 dark:text-white outline-none transition-all"
                      placeholder="e.g. gpt-4o" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-light-500 dark:text-slate-500 px-1">Neural Gateway (Endpoint)</label>
                  <input type="text" value={formData.api_base} onChange={e => setFormData({...formData, api_base: e.target.value})}
                    className="w-full bg-light-50 dark:bg-dark-950/50 border border-light-200 dark:border-slate-800/80 rounded-2xl px-5 py-3.5 text-sm font-bold text-light-900 dark:text-white outline-none transition-all"
                    placeholder={formData.provider_type === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'} />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-light-500 dark:text-slate-500 px-1">Chứng chỉ truy cập (API Key)</label>
                  <div className="relative">
                    <input type="password" value={formData.api_key} onChange={e => setFormData({...formData, api_key: e.target.value})}
                      className="w-full bg-light-50 dark:bg-dark-950/50 border border-light-200 dark:border-slate-800/80 rounded-2xl px-12 py-3.5 text-sm font-mono text-light-900 dark:text-white outline-none transition-all"
                      placeholder={editingProvider && formData.api_key.startsWith('***') ? '••••••••' : 'Nhập API Key'} />
                    <Key size={14} className="absolute left-5 top-1/2 -translate-y-1/2 text-light-400 dark:text-slate-600" />
                  </div>
                </div>
              </div>

              <div className="px-8 py-6 bg-light-50/50 dark:bg-dark-950/40 border-t border-light-100 dark:border-slate-800/60 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 text-xs font-black uppercase tracking-widest text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800 rounded-xl transition-all">Hủy</button>
                <button type="submit" disabled={saving} className="px-8 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary-500 shadow-lg shadow-primary-500/20 active:scale-95 transition-all">
                  {saving ? 'Đang xử lý...' : 'Xác thực bảo mật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
