import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import {
  Brain as BrainIcon, Heart, Database, ScrollText, Sparkles, Plus, Trash2, RefreshCw, Send,
  ChevronDown, ChevronRight, Loader2, BookOpen, Eye,
  MessageCircle, GraduationCap, CheckCircle2, AlertCircle, AlertTriangle,
  Edit3, X, Zap, Shield, User, Settings, Filter, Download,
  Activity, ZapOff, Book, Terminal, Cpu
} from 'lucide-react'

// ── Shared UI Components ──────────────────────────────────────────────

function Card({ children, className = "", title, icon: Icon, color = "primary", extra, count, isOpen, onToggle }) {
  const colors = {
    primary: "from-primary-500/10 to-transparent border-primary-500/20 text-primary-500 bg-primary-500/5",
    pink: "from-pink-500/10 to-transparent border-pink-500/20 text-pink-500 bg-pink-500/5",
    orange: "from-orange-500/10 to-transparent border-orange-500/20 text-orange-500 bg-orange-500/5",
    blue: "from-blue-500/10 to-transparent border-blue-500/20 text-blue-500 bg-blue-500/5"
  }

  return (
    <div className={`group relative overflow-hidden bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-[2rem] shadow-sm hover:shadow-xl hover:shadow-primary-500/5 transition-all duration-500 ${className}`}>
      {/* Decorative Gradient Background */}
      <div className={`absolute top-0 left-0 w-full h-24 bg-gradient-to-b opacity-50 dark:opacity-30 ${colors[color].split(' ')[0]} ${colors[color].split(' ')[1]}`} />
      
      <div className="relative p-7">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className={`p-3.5 rounded-2xl shadow-lg shadow-black/5 flex items-center justify-center transition-transform group-hover:scale-110 duration-500 ${colors[color].split(' ').pop()}`}>
              <Icon size={22} className={colors[color].split(' ').slice(2, 3).join(' ')} />
            </div>
            <div>
              <h3 className="text-lg font-black text-light-900 dark:text-white tracking-tight">{title}</h3>
              {count !== undefined && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">{count} records indexed</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
             {extra}
             {onToggle && (
                <button onClick={onToggle} className="p-2 hover:bg-light-100 dark:hover:bg-dark-800 rounded-full transition-colors text-light-400 dark:text-slate-500">
                  {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
             )}
          </div>
        </div>
        
        <div className={`transition-all duration-500 ${onToggle && !isOpen ? 'h-0 opacity-0 overflow-hidden' : 'opacity-100'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

function StatTile({ label, value, icon: Icon, colorClass }) {
  return (
    <div className="bg-white dark:bg-dark-900/60 border border-light-200 dark:border-slate-800/60 p-5 rounded-3xl flex items-center gap-4 hover:border-primary-500/30 transition-all group">
      <div className={`p-3 rounded-2xl ${colorClass.replace('text-', 'bg-').replace('500', '500/10')}`}>
        <Icon size={20} className={colorClass} />
      </div>
      <div>
        <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
        <p className="text-xl font-black text-light-900 dark:text-white tracking-tight">{value}</p>
      </div>
    </div>
  )
}

// ── Modals ──────────────────────────────────────────────────────

function KnowledgeModal({ topic, onClose, onUpdate }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)

  const fetchEntries = useCallback(() => {
    setLoading(true)
    api.get(`/memory/knowledge/${encodeURIComponent(topic)}`).then(res => {
      setEntries(res.data.entries || [])
      setLoading(false)
    })
  }, [topic])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const deleteEntry = async (id) => {
    setDeletingId(id)
    try {
      await api.delete(`/memory/knowledge/${encodeURIComponent(topic)}/${id}`)
      fetchEntries()
    } finally { setDeletingId(null) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-[2.5rem] w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-8 py-6 border-b border-light-100 dark:border-slate-800/60 bg-light-50/50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
               <BookOpen size={24} />
             </div>
             <div>
               <h3 className="text-xl font-black text-light-900 dark:text-white capitalize">Knowledge: {topic}</h3>
               <p className="text-xs font-medium text-light-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Exploring indexed memory chunks</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-light-100 dark:hover:bg-dark-800 rounded-full transition-colors">
            <X size={24} className="text-light-400 dark:text-slate-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-4 custom-scrollbar">
           {loading ? (
             <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
           ) : entries.length > 0 ? (
             entries.map((entry, i) => (
               <div key={entry.id} className="p-6 bg-light-50/50 dark:bg-dark-950/40 border border-light-100 dark:border-slate-800/40 rounded-[1.5rem] group relative animate-slide-in" style={{ animationDelay: `${i * 0.05}s` }}>
                  <p className="text-sm text-light-800 dark:text-slate-300 leading-relaxed pr-8 font-medium">{entry.content}</p>
                  <div className="mt-4 pt-4 border-t border-light-200/50 dark:border-slate-800/50 flex items-center justify-between">
                     <span className="text-[10px] font-bold text-light-400 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                       <Shield size={10} /> source: {entry.metadata?.source || 'unknown'}
                     </span>
                     <button onClick={() => deleteEntry(entry.id)} disabled={deletingId === entry.id}
                        className="text-light-400 hover:text-red-500 p-2 hover:bg-red-500/5 rounded-lg transition-all">
                        {deletingId === entry.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                     </button>
                  </div>
               </div>
             ))
           ) : (
             <div className="h-full flex flex-col items-center justify-center text-light-400 dark:text-slate-600">
               <div className="w-20 h-20 bg-light-100 dark:bg-dark-800 rounded-full flex items-center justify-center mb-6 opacity-40">
                 <Database size={32} />
               </div>
               <p className="text-lg font-bold">This domain is empty.</p>
               <p className="text-sm mt-1 opacity-60">No data records found in this neural sector.</p>
             </div>
           )}
        </div>
      </div>
    </div>
  )
}

function TeachModal({ onClose, onTeach }) {
  const [category, setCategory] = useState('knowledge')
  const [content, setContent] = useState('')
  const [topic, setTopic] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const handleSubmit = async () => {
    if (!content.trim()) return
    setSending(true)
    try {
      const res = await api.post('/memory/teach', { category, content, topic: topic || undefined })
      setResult(res.data.message || res.data.error)
      if (res.data.message) {
        setTimeout(() => { onTeach(); onClose() }, 800)
      }
    } catch (e) {
      setResult('Lỗi: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSending(false)
    }
  }

  const categories = [
    { key: 'soul', label: 'Tính cách', desc: 'Hành vi cốt lõi', icon: Heart, color: 'text-pink-500' },
    { key: 'knowledge', label: 'Tri thức', desc: 'Dữ liệu & Sự thật', icon: Database, color: 'text-blue-500' },
    { key: 'preference', label: 'Sở thích', desc: 'Thói quen user', icon: User, color: 'text-primary-500' },
  ]

  const suggestions = ['Lịch sử', 'Địa lý', 'Văn hóa', 'Đạo đức', 'Toán học', 'Ngôn ngữ', 'Xã hội', 'Kỹ năng sống']

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-8 py-6 border-b border-light-100 dark:border-slate-800/60">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-primary-500/10 rounded-2xl text-primary-500">
               <GraduationCap size={24} />
             </div>
             <div>
               <h3 className="text-xl font-black text-light-900 dark:text-white">Dạy dỗ & Tinh chỉnh Agent</h3>
               <p className="text-xs font-medium text-light-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Cập nhật hệ thống tri thức và tính cách</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-light-100 dark:hover:bg-dark-800 rounded-full transition-colors">
            <X size={24} className="text-light-400 dark:text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-8">
          <div className="grid grid-cols-1 gap-3">
            <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-1">Phân vùng bộ nhớ</p>
            <div className="grid grid-cols-3 gap-4">
              {categories.map(c => (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  className={`flex flex-col items-center text-center p-4 rounded-3xl border transition-all duration-300 relative overflow-hidden group ${
                    category === c.key
                      ? 'border-primary-500 bg-primary-500/5 ring-1 ring-primary-500/20'
                      : 'border-light-200 dark:border-slate-800 bg-light-50/50 dark:bg-dark-950/40 hover:border-primary-500/30'
                  }`}>
                  <c.icon size={20} className={`${c.color} group-hover:scale-110 transition-transform`} />
                  <p className="text-[11px] font-black mt-3 text-light-900 dark:text-white uppercase tracking-tight">{c.label}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            {category === 'knowledge' && (
              <div className="space-y-4 animate-slide-up">
                <div>
                  <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest mb-3">Kiến thức đề xuất</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map(s => (
                      <button key={s} onClick={() => setTopic(s)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${
                          topic === s 
                            ? 'bg-primary-600 border-primary-600 text-white shadow-lg shadow-primary-600/20' 
                            : 'bg-light-50/50 dark:bg-dark-950/40 border-light-200 dark:border-slate-800 text-light-500 dark:text-slate-400 hover:border-primary-500/50'
                        }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative group">
                  <input value={topic} onChange={e => setTopic(e.target.value)}
                    placeholder="Tên miền tri thức (Ví dụ: Lịch sử, Tài chính...)"
                    className="w-full bg-light-50/80 dark:bg-dark-950/60 border border-light-200 dark:border-slate-800/80 rounded-2xl px-5 py-4 text-sm text-light-900 dark:text-white focus:border-primary-500 focus:bg-white dark:focus:bg-dark-950 outline-none transition-all placeholder:text-light-300 dark:placeholder:text-slate-600 block" />
                </div>
              </div>
            )}

            <div className="relative animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                placeholder="Mô tả những gì Agent nên học tập, ghi nhớ hoặc cách thay đổi tính cách..."
                rows={6}
                className="w-full bg-light-50/80 dark:bg-dark-950/60 border border-light-200 dark:border-slate-800/80 rounded-[1.5rem] px-5 py-4 text-sm text-light-900 dark:text-white focus:border-primary-500 focus:bg-white dark:focus:bg-dark-950 outline-none transition-all resize-none shadow-inner placeholder:text-light-300 dark:placeholder:text-slate-600 font-medium leading-relaxed" />
              <div className="absolute top-2 right-2 p-2">
                <div className={`w-2 h-2 rounded-full ${content.trim() ? 'bg-primary-500 shadow-lg shadow-primary-500/50' : 'bg-light-200 dark:bg-slate-800'}`} />
              </div>
            </div>
          </div>

          {result && (
            <div className={`text-xs px-5 py-4 rounded-2xl font-bold animate-fade-in flex items-center gap-3 ${result.startsWith('Lỗi') ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
              {result.startsWith('Lỗi') ? <AlertCircle size={16} /> : <Sparkles size={16} />}
              {result}
            </div>
          )}
        </div>

        <div className="px-8 py-8 bg-light-50/50 dark:bg-white/[0.01] border-t border-light-100 dark:border-slate-800/60">
          <button onClick={handleSubmit} disabled={sending || !content.trim()}
            className="w-full h-14 flex items-center justify-center gap-3 bg-primary-600 text-white rounded-[1.2rem] hover:bg-primary-500 transition-all font-black text-sm shadow-xl shadow-primary-600/30 active:scale-95 disabled:opacity-50 group">
            {sending ? <Loader2 size={20} className="animate-spin" /> : (
              <>
                <Zap size={18} className="group-hover:fill-current" />
                CẬP NHẬT TRÍ TUỆ
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────

export default function Brain() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showTeach, setShowTeach] = useState(false)
  const [editingSoul, setEditingSoul] = useState(false)
  const [soulDraft, setSoulDraft] = useState('')
  const [savingSoul, setSavingSoul] = useState(false)
  const [editingScratch, setEditingScratch] = useState(false)
  const [scratchDraft, setScratchDraft] = useState('')
  const [savingScratch, setSavingScratch] = useState(false)
  
  const [viewingKnowledgeTopic, setViewingKnowledgeTopic] = useState(null)
  const [editingPreference, setEditingPreference] = useState(null) // {key, value}

  const [openSections, setOpenSections] = useState({
    soul: true,
    preferences: true,
    knowledge: true,
    scratchpad: false
  })

  const toggleSection = (id) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }))

  const fetchData = useCallback(async () => {
    try {
      const brainRes = await api.get('/memory/overview')
      setData(brainRes.data)
      setSoulDraft(brainRes.data?.soul?.content || '')
      setScratchDraft(brainRes.data?.scratchpad?.content || '')
    } catch (e) {
      console.error('Brain fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const saveSoul = async () => {
    setSavingSoul(true)
    try {
      await api.post('/memory/soul', { content: soulDraft })
      await fetchData()
      setEditingSoul(false)
    } finally { setSavingSoul(false) }
  }

  const saveScratchpad = async () => {
    setSavingScratch(true)
    try {
      await api.post('/memory/scratchpad', { content: scratchDraft })
      await fetchData()
      setEditingScratch(false)
    } finally { setSavingScratch(false) }
  }

  const savePreference = async (key, value) => {
    try {
      await api.post('/memory/preferences', { key, value })
      fetchData()
      setEditingPreference(null)
    } catch {}
  }

  const deletePreference = async (key) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa tùy chỉnh "${key}"?`)) return
    try { 
      await api.post(`/memory/preferences/remove`, { key })
      fetchData() 
    } catch (e) {
      alert("Lỗi khi xóa tùy chỉnh: " + (e.response?.data?.detail || e.message))
    }
  }

  const deleteKnowledgeTopic = async (topic) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa chủ đề tri thức "${topic}"?`)) return
    try { 
      await api.post(`/memory/knowledge/remove`, { topic })
      fetchData() 
    } catch (e) {
      alert("Lỗi khi xóa tri thức: " + (e.response?.data?.detail || e.message))
    }
  }

  const wipeAllMemory = async () => {
    if (!window.confirm("CẢNH BÁO: Hành động này sẽ xóa VĨNH VIỄN toàn bộ trí nhớ, kiến thức đã học, các phiên hội thoại và sở thích của Agent. Bạn có chắc chắn muốn thực hiện?")) {
      return
    }
    if (!window.confirm("BẠN CÓ CHẮC CHẮN 100%? Không thể hoàn tác.")) {
      return
    }
    try {
      await api.delete('/memory/wipe')
      window.location.reload()
    } catch (e) {
      alert("Lỗi khi xóa bộ nhớ: " + e.message)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-light-50 dark:bg-dark-950">
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 bg-primary-500/20 blur-2xl rounded-full animate-pulse" />
          <BrainIcon className="animate-spin-slow text-primary-500 relative" size={64} />
        </div>
        <div className="flex flex-col items-center gap-2">
           <p className="text-lg font-black text-light-900 dark:text-white tracking-widest uppercase">Đang khởi động</p>
           <p className="text-xs font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest animate-pulse">Cập nhật trí tuệ...</p>
        </div>
      </div>
    </div>
  )

  const b = data || {}
  const totalKnowledge = b.knowledge?.topics?.reduce((acc, t) => acc + t.count, 0) || 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <BrainIcon size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">
              Trí nhớ Agent
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchData} title="Sync Synapses" className="p-2.5 text-light-500 dark:text-slate-400 hover:text-primary-500 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl transition-all shadow-sm">
              <RefreshCw size={20} />
            </button>
            <button onClick={() => setShowTeach(true)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-xl hover:bg-primary-500 transition-all font-bold text-xs shadow-lg shadow-primary-600/20 active:scale-95 group">
              <GraduationCap size={16} />
              DẠY AGENT
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[#F8FAFC] dark:bg-[#030711] p-6 lg:p-10 space-y-12 custom-scrollbar">
        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
          <StatTile label="Knowledge Chunks" value={totalKnowledge} icon={Database} colorClass="text-blue-500" />
          <StatTile label="Personality State" value={b.soul?.content ? 'DEFINED' : 'VACUUM'} icon={Heart} colorClass="text-pink-500" />
          <StatTile label="Preferences" value={Object.keys(b.preferences || {}).filter(k => !k.startsWith('_')).length} icon={User} colorClass="text-primary-500" />
        </div>
      
        {/* Main Neural Map */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 lg:gap-10">
        
        {/* Core Identity */}
        <div className="xl:col-span-12 space-y-8 lg:space-y-10">
          <Card title="Tính cách & Bản sắc" icon={Heart} color="pink" 
            isOpen={openSections.soul} onToggle={() => toggleSection('soul')}
            extra={!editingSoul && (
              <button onClick={() => setEditingSoul(true)} className="flex items-center gap-2 px-6 py-2.5 bg-pink-500/10 text-pink-500 hover:bg-pink-500 hover:text-white rounded-2xl transition-all font-bold text-xs border border-pink-500/20 group">
                <Edit3 size={14} className="group-hover:rotate-12 transition-transform" /> CHỈNH SỬA
              </button>
            )}>
            <div className="space-y-6">
              {editingSoul ? (
                <div className="space-y-6 animate-scale-in">
                  <div className="relative group">
                    <div className="absolute top-4 left-4 p-2 bg-pink-500/10 rounded-lg text-pink-500 opacity-50"><Terminal size={14} /></div>
                    <textarea value={soulDraft} onChange={e => setSoulDraft(e.target.value)}
                      rows={8}
                      className="w-full bg-light-50/50 dark:bg-dark-950/50 border border-pink-500/20 rounded-[2rem] px-8 py-8 md:pl-14 text-xs text-light-800 dark:text-slate-300 font-mono focus:border-pink-500/50 outline-none transition-all shadow-inner leading-relaxed custom-scrollbar" />
                  </div>
                  <div className="flex justify-end items-center gap-6">
                    <button onClick={() => { setEditingSoul(false); setSoulDraft(b.soul?.content || '') }} className="text-xs font-black text-light-400 hover:text-light-900 dark:hover:text-white transition-colors uppercase tracking-[0.2em]">HỦY</button>
                    <button onClick={saveSoul} disabled={savingSoul} className="bg-pink-600 text-white text-xs font-black px-10 py-4 rounded-2xl hover:bg-pink-500 transition-all shadow-xl shadow-pink-600/20 hover:-translate-y-1 active:translate-y-0">
                      {savingSoul ? 'ĐANG LƯU...' : 'CẬP NHẬT TÍNH CÁCH'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative group overflow-hidden">
                  <div className="absolute inset-0 bg-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="bg-light-50/10 dark:bg-dark-950/20 rounded-3xl p-6 border border-light-200/50 dark:border-slate-800/40 font-mono text-xs text-light-800 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-[250px] overflow-y-auto custom-scrollbar shadow-inner">
                    {b.soul?.content || 'Soul vacuum detected. AI is currently in default blank state.'}
                  </div>
                </div>
              )}
            </div>
          </Card>


        </div>

        {/* ── Unified Personal Intelligence ─────────────────────── */}
        <div className="xl:col-span-12 space-y-8 lg:space-y-10 animate-slide-in" style={{ animationDelay: '0.1s' }}>
          <Card 
            title="Bộ nhớ & Năng lực cá nhân" 
            icon={Database} 
            color="blue" 
            count={(b.knowledge?.total_topics || 0) + (Object.keys(b.preferences || {}).filter(k => !k.startsWith('_')).length) + (b.skills?.total || 0)}
            isOpen={openSections.knowledge}
            onToggle={() => toggleSection('knowledge')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              {/* Preferences Section */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-light-100 dark:border-slate-800/40 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-500/10 rounded-lg text-primary-500"><User size={16} /></div>
                    <div>
                      <h4 className="text-sm font-black text-light-900 dark:text-white uppercase tracking-widest">Ghi nhớ & Tùy chỉnh</h4>
                      <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-tighter">Personal Context</p>
                    </div>
                  </div>
                  <button onClick={() => setEditingPreference({key: '', value: ''})} className="px-4 py-2 bg-primary-600/10 text-primary-600 hover:bg-primary-600 hover:text-white rounded-xl transition-all text-[10px] font-black uppercase tracking-widest">
                    THÊM
                  </button>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {Object.entries(b.preferences || {}).filter(([k]) => !k.startsWith('_')).map(([k, v], i) => (
                    <div key={k} className="p-4 bg-light-50/50 dark:bg-white/[0.02] border border-light-200 dark:border-slate-800/40 rounded-2xl group hover:border-primary-500/30 transition-all">
                       <div className="flex items-center justify-between gap-4">
                          <div className="flex-1">
                             <p className="text-[10px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-1">{k}</p>
                             {editingPreference?.key === k ? (
                               <div className="flex gap-2">
                                 <input value={editingPreference.value} onChange={e => setEditingPreference({...editingPreference, value: e.target.value})}
                                   className="flex-1 bg-white dark:bg-dark-900 border border-primary-500/30 rounded-lg px-3 py-1 text-xs outline-none" autoFocus />
                                 <button onClick={() => { savePreference(k, editingPreference.value); setEditingPreference(null) }} className="text-emerald-500 p-1 hover:bg-emerald-500/10 rounded"><CheckCircle2 size={16} /></button>
                               </div>
                             ) : (
                               <p className="text-sm font-bold text-light-800 dark:text-slate-200 leading-snug">{v}</p>
                             )}
                          </div>
                          {!editingPreference && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button onClick={() => setEditingPreference({key: k, value: v})} className="p-2 text-light-400 hover:text-primary-500 hover:bg-primary-500/10 rounded-lg"><Edit3 size={14} /></button>
                               <button onClick={() => deletePreference(k)} className="p-2 text-light-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg"><Trash2 size={14} /></button>
                            </div>
                          )}
                       </div>
                    </div>
                  ))}
                  {Object.entries(b.preferences || {}).filter(([k]) => !k.startsWith('_')).length === 0 && (
                    <div className="py-10 text-center opacity-30">
                       <User size={24} className="mx-auto mb-2" />
                       <p className="text-[10px] font-bold uppercase">Trống</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Knowledge Section */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-light-100 dark:border-slate-800/40 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500"><Database size={16} /></div>
                    <div>
                      <h4 className="text-sm font-black text-light-900 dark:text-white uppercase tracking-widest">Kho tri thức</h4>
                      <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-tighter">Neural Index (RAG)</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {b.knowledge?.topics?.map((t, i) => (
                    <div key={t.topic} className="p-4 bg-light-50/50 dark:bg-white/[0.02] border border-light-200 dark:border-slate-800/40 rounded-2xl group hover:border-blue-500/30 transition-all cursor-pointer relative" onClick={() => setViewingKnowledgeTopic(t.topic)}>
                       <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-500 group-hover:scale-110 transition-transform">
                             <BookOpen size={16} />
                          </div>
                          <div className="flex-1 pr-6">
                             <h4 className="text-xs font-black text-light-900 dark:text-white capitalize truncate">{t.topic}</h4>
                             <p className="text-[9px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-tighter">{t.count} indexed nodes</p>
                          </div>
                       </div>
                       <button onClick={(e) => { e.stopPropagation(); deleteKnowledgeTopic(t.topic); }} className="absolute top-2 right-2 p-1.5 text-light-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                          <Trash2 size={12} />
                       </button>
                    </div>
                  ))}
                  {(!b.knowledge?.topics || b.knowledge?.topics?.length === 0) && (
                    <div className="py-10 text-center opacity-30">
                       <Database size={24} className="mx-auto mb-2" />
                       <p className="text-[10px] font-bold uppercase tracking-widest">Không có tri thức</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Skills Section */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-light-100 dark:border-slate-800/40 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500"><Zap size={16} /></div>
                    <div>
                      <h4 className="text-sm font-black text-light-900 dark:text-white uppercase tracking-widest">Công cụ Trí nhớ Agent</h4>
                      <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-tighter">Python Extensions</p>
                    </div>
                  </div>
                  <Link to="/skills" className="px-4 py-2 bg-emerald-600/10 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-xl transition-all text-[10px] font-black uppercase tracking-widest">
                    QUẢN LÝ
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {b.skills?.list?.map((s, i) => (
                    <div key={s.id} className="p-4 bg-light-50/50 dark:bg-white/[0.02] border border-light-200 dark:border-slate-800/40 rounded-2xl group hover:border-emerald-500/30 transition-all">
                       <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl transition-transform ${s.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-500'}`}>
                             <Terminal size={16} />
                          </div>
                          <div className="flex-1">
                             <h4 className="text-xs font-black text-light-900 dark:text-white">{s.name}</h4>
                             <p className="text-[9px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-tighter font-mono">{s.tool_name}</p>
                          </div>
                       </div>
                    </div>
                  ))}
                  {(!b.skills?.list || b.skills?.list?.length === 0) && (
                    <div className="py-10 text-center opacity-30">
                       <Zap size={24} className="mx-auto mb-2" />
                       <p className="text-[10px] font-bold uppercase tracking-widest">Chưa có kỹ năng</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Danger Zone */}
        <div className="xl:col-span-12 mt-10">
          <Card title="Phân vùng Nguy hiểm" icon={AlertTriangle} color="orange" className="border-red-500/20 bg-red-500/5">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h3 className="text-lg font-black text-red-600 dark:text-red-400 flex items-center gap-2 mb-1">
                  Cảnh báo Hệ thống
                </h3>
                <p className="text-sm text-red-500/60 font-medium leading-relaxed">
                  Xóa sạch toàn bộ tri thức, kỹ năng và ghi nhớ đã học của User này. Hành động không thể hoàn tác.
                </p>
              </div>
              <button 
                onClick={wipeAllMemory}
                className="w-full md:w-auto px-8 py-3 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-500 transition-all shadow-lg shadow-red-600/20 active:scale-95 flex items-center justify-center gap-2"
              >
                <Trash2 size={16} /> XÓA SẠCH TRÍ NHỚ
              </button>
            </div>
          </Card>
        </div>

      </div>
    </div>

    {/* Overlays */}
    {showTeach && <TeachModal onClose={() => setShowTeach(false)} onTeach={fetchData} />}
    {viewingKnowledgeTopic && <KnowledgeModal topic={viewingKnowledgeTopic} onClose={() => setViewingKnowledgeTopic(null)} onUpdate={fetchData} />}
  </div>
)
}
