import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import {
  Brain as BrainIcon, Heart, Database, ScrollText, Sparkles, Plus, Trash2, RefreshCw, Send,
  ChevronDown, ChevronRight, Loader2, BookOpen, Eye,
  MessageCircle, GraduationCap, CheckCircle2, AlertCircle,
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
    api.get(`/memory/knowledge/${topic}`).then(res => {
      setEntries(res.data.entries || [])
      setLoading(false)
    })
  }, [topic])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const deleteEntry = async (id) => {
    setDeletingId(id)
    try {
      await api.delete(`/memory/knowledge/${topic}/${id}`)
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
      setResult('Error: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSending(false)
    }
  }

  const categories = [
    { key: 'soul', label: 'Personality', desc: 'Core behaviors', icon: Heart, color: 'text-pink-500' },
    { key: 'knowledge', label: 'Knowledge', desc: 'Facts & data', icon: Database, color: 'text-blue-500' },
    { key: 'preference', label: 'Preference', desc: 'User habits', icon: User, color: 'text-primary-500' },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-8 py-6 border-b border-light-100 dark:border-slate-800/60">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-primary-500/10 rounded-2xl text-primary-500">
               <GraduationCap size={24} />
             </div>
             <div>
               <h3 className="text-xl font-black text-light-900 dark:text-white">Fine-tune Agent</h3>
               <p className="text-xs font-medium text-light-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">Injecting neural instructions</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-light-100 dark:hover:bg-dark-800 rounded-full transition-colors">
            <X size={24} className="text-light-400 dark:text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-8">
          <div className="grid grid-cols-1 gap-3">
            <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-1">Memory Segment</p>
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
              <div className="relative group animate-slide-up">
                <input value={topic} onChange={e => setTopic(e.target.value)}
                  placeholder="Knowledge Domain Name (e.g. Finance, Biology)"
                  className="w-full bg-light-50/80 dark:bg-dark-950/60 border border-light-200 dark:border-slate-800/80 rounded-2xl px-5 py-4 text-sm text-light-900 dark:text-white focus:border-primary-500 focus:bg-white dark:focus:bg-dark-950 outline-none transition-all placeholder:text-light-300 dark:placeholder:text-slate-600 block" />
              </div>
            )}

            <div className="relative animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                placeholder="Describe what the agent should learn, remember, or how its personality should change..."
                rows={6}
                className="w-full bg-light-50/80 dark:bg-dark-950/60 border border-light-200 dark:border-slate-800/80 rounded-[1.5rem] px-5 py-4 text-sm text-light-900 dark:text-white focus:border-primary-500 focus:bg-white dark:focus:bg-dark-950 outline-none transition-all resize-none shadow-inner placeholder:text-light-300 dark:placeholder:text-slate-600 font-medium leading-relaxed" />
              <div className="absolute top-2 right-2 p-2">
                <div className={`w-2 h-2 rounded-full ${content.trim() ? 'bg-primary-500 shadow-lg shadow-primary-500/50' : 'bg-light-200 dark:bg-slate-800'}`} />
              </div>
            </div>
          </div>

          {result && (
            <div className={`text-xs px-5 py-4 rounded-2xl font-bold animate-fade-in flex items-center gap-3 ${result.startsWith('Error') ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
              {result.startsWith('Error') ? <AlertCircle size={16} /> : <Sparkles size={16} />}
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
                EXECUTE NEURAL UPDATE
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
    scratchpad: true
  })

  const toggleSection = (id) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }))

  const fetchData = useCallback(async () => {
    try {
      const brainRes = await api.get('/memory/overview')
      setData(brainRes.data)
      setSoulDraft(brainRes.data.soul?.content || '')
      setScratchDraft(brainRes.data.scratchpad?.content || '')
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
    if (!confirm(`Delete preference "${key}"?`)) return
    try { await api.delete(`/memory/preferences/${key}`); fetchData() } catch {}
  }

  const deleteKnowledgeTopic = async (topic) => {
    if (!confirm(`Delete ENTIRE topic "${topic}"?`)) return
    try { await api.delete(`/memory/knowledge/${topic}`); fetchData() } catch {}
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-light-50 dark:bg-dark-950">
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 bg-primary-500/20 blur-2xl rounded-full animate-pulse" />
          <BrainIcon className="animate-spin-slow text-primary-500 relative" size={64} />
        </div>
        <div className="flex flex-col items-center gap-2">
           <p className="text-lg font-black text-light-900 dark:text-white tracking-widest uppercase">Initializing Neural Link</p>
           <p className="text-xs font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest animate-pulse">Syncing Synapses...</p>
        </div>
      </div>
    </div>
  )

  const b = data || {}
  const totalKnowledge = b.knowledge?.topics?.reduce((acc, t) => acc + t.count, 0) || 0

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC] dark:bg-[#030711] p-6 lg:p-10 space-y-12 custom-scrollbar">
      {/* Dynamic Header */}
      <div className="relative">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-primary-500/10 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-8 pb-10">
          <div className="flex items-center gap-8">
            <div className="relative group">
              <div className="absolute inset-0 bg-primary-500/30 blur-2xl rounded-[2.5rem] opacity-0 group-hover:opacity-100 transition-all duration-700" />
              <div className="w-24 h-24 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-[2.5rem] flex items-center justify-center shadow-2xl relative transition-transform duration-700 group-hover:rotate-[360deg] group-hover:scale-110">
                <BrainIcon size={44} className="text-primary-600 dark:text-primary-500" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-2xl flex items-center justify-center border-4 border-white dark:border-dark-950 shadow-lg">
                <Activity size={14} className="text-white animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-3 py-1 bg-primary-500/10 text-primary-600 dark:text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] rounded-full border border-primary-500/20">System-level Access</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
              </div>
              <h1 className="text-5xl font-black text-light-900 dark:text-white tracking-tighter">HatAI Brain Central</h1>
              <p className="text-sm font-medium text-light-500 dark:text-slate-400 mt-2 max-w-xl leading-relaxed">
                Direct neural interface for modifying personality cores, injected knowledge graphs, and persistent user preferences.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button onClick={fetchData} className="w-14 h-14 flex items-center justify-center text-light-500 dark:text-slate-400 hover:text-primary-500 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-3xl transition-all shadow-xl hover:shadow-primary-500/10 hover:-translate-y-1 active:scale-90">
              <RefreshCw size={24} />
            </button>
            <button onClick={() => setShowTeach(true)} className="flex items-center gap-3 bg-primary-600 text-white px-10 py-5 rounded-3xl hover:bg-primary-500 transition-all font-black text-sm shadow-2xl shadow-primary-600/30 active:scale-95 group">
              <GraduationCap size={22} className="group-hover:rotate-12 transition-transform" />
              INJECT NEW DATA
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in">
          <StatTile label="Knowledge Chunks" value={totalKnowledge} icon={Database} colorClass="text-blue-500" />
          <StatTile label="Personality State" value={b.soul?.content ? 'DEFINED' : 'VACUUM'} icon={Heart} colorClass="text-pink-500" />
          <StatTile label="Preferences" value={Object.keys(b.preferences || {}).length} icon={User} colorClass="text-primary-500" />
          <StatTile label="Scratchpad Load" value={`${b.scratchpad?.size || 0} bytes`} icon={Cpu} colorClass="text-orange-500" />
        </div>
      </div>

      {/* Main Neural Map */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 lg:gap-10">
        
        {/* Left Column: Core Identity */}
        <div className="xl:col-span-8 space-y-8 lg:space-y-10">
          <Card title="Personality Core (soul_memory.md)" icon={Heart} color="pink" 
            isOpen={openSections.soul} onToggle={() => toggleSection('soul')}
            extra={!editingSoul && (
              <button onClick={() => setEditingSoul(true)} className="flex items-center gap-2 px-6 py-2.5 bg-pink-500/10 text-pink-500 hover:bg-pink-500 hover:text-white rounded-2xl transition-all font-bold text-xs border border-pink-500/20 group">
                <Edit3 size={14} className="group-hover:rotate-12 transition-transform" /> REPROGRAM
              </button>
            )}>
            <div className="space-y-6">
              {editingSoul ? (
                <div className="space-y-6 animate-scale-in">
                  <div className="relative group">
                    <div className="absolute top-4 left-4 p-2 bg-pink-500/10 rounded-lg text-pink-500 opacity-50"><Terminal size={14} /></div>
                    <textarea value={soulDraft} onChange={e => setSoulDraft(e.target.value)}
                      rows={16}
                      className="w-full bg-light-50/50 dark:bg-dark-950/50 border border-pink-500/20 rounded-[2rem] px-8 py-10 md:pl-14 text-sm text-light-800 dark:text-slate-300 font-mono focus:border-pink-500/50 outline-none transition-all shadow-inner leading-relaxed custom-scrollbar" />
                  </div>
                  <div className="flex justify-end items-center gap-6">
                    <button onClick={() => { setEditingSoul(false); setSoulDraft(b.soul?.content || '') }} className="text-xs font-black text-light-400 hover:text-light-900 dark:hover:text-white transition-colors uppercase tracking-[0.2em]">ABORT</button>
                    <button onClick={saveSoul} disabled={savingSoul} className="bg-pink-600 text-white text-xs font-black px-10 py-4 rounded-2xl hover:bg-pink-500 transition-all shadow-xl shadow-pink-600/20 hover:-translate-y-1 active:translate-y-0">
                      {savingSoul ? 'SYNCING...' : 'COMMIT TO SOUL'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative group overflow-hidden">
                  <div className="absolute inset-0 bg-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="bg-light-50/10 dark:bg-dark-950/20 rounded-3xl p-8 border border-light-200/50 dark:border-slate-800/40 font-mono text-[13px] text-light-800 dark:text-slate-300 whitespace-pre-wrap leading-loose max-h-[500px] overflow-y-auto custom-scrollbar shadow-inner">
                    {b.soul?.content || 'Soul vacuum detected. AI is currently in default blank state.'}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             {/* Hide Scratchpad from UI as requested by user */}
             {/* 
             <Card title="Live Scratchpad" icon={ScrollText} color="orange" 
                isOpen={openSections.scratchpad} onToggle={() => toggleSection('scratchpad')}
                extra={!editingScratch && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingScratch(true)} className="p-2 text-orange-500 hover:bg-orange-500/10 rounded-xl transition-all"><Edit3 size={18}/></button>
                    <button onClick={() => { if(confirm('Purge?')) api.delete('/memory/scratchpad').then(fetchData) }} className="p-2 text-orange-300 hover:text-red-500 transition-all"><Trash2 size={18}/></button>
                  </div>
                )}>
                <div className="mt-2">
                   {editingScratch ? (
                      <div className="space-y-4 animate-scale-in">
                         <textarea value={scratchDraft} onChange={e => setScratchDraft(e.target.value)}
                           rows={8}
                           className="w-full bg-orange-500/5 border border-orange-500/20 rounded-2xl p-6 text-xs font-mono text-light-800 dark:text-orange-100/70 focus:border-orange-500 outline-none transition-all shadow-inner leading-relaxed" />
                         <div className="flex justify-end gap-4">
                            <button onClick={() => setEditingScratch(false)} className="text-[10px] font-black text-light-400 hover:text-light-900 uppercase tracking-widest">DISCARD</button>
                            <button onClick={saveScratchpad} disabled={savingScratch} className="bg-orange-600 text-white text-[10px] font-black px-6 py-2.5 rounded-xl hover:bg-orange-500 transition-all shadow-lg shadow-orange-600/20">
                               {savingScratch ? 'SAVING...' : 'SYNC NOTES'}
                            </button>
                         </div>
                      </div>
                   ) : (
                      <div className="bg-orange-500/5 border border-orange-500/10 rounded-2xl p-6 font-mono text-xs text-light-700 dark:text-orange-200/60 max-h-[220px] overflow-y-auto leading-loose italic relative group">
                         <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity"><Zap size={24} className="text-orange-500" /></div>
                         {b.scratchpad?.content || 'Scratchpad is currently idle.'}
                      </div>
                   )}
                </div>
             </Card>
             */}

             <Card title="Hardware Insights" icon={Cpu} color="primary" isOpen={openSections.preferences} onToggle={() => toggleSection('preferences')}>
                <div className="space-y-4 mt-2">
                   <div className="grid grid-cols-1 gap-4">
                      <div className="flex items-center justify-between p-4 bg-primary-500/5 border border-primary-500/10 rounded-2xl">
                         <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-500"><Activity size={18}/></div>
                            <div>
                               <p className="text-[11px] font-black text-light-900 dark:text-white tracking-widest uppercase">Memory Utilization</p>
                               <p className="text-[10px] text-light-400 dark:text-slate-500 font-bold">Real-time neural load</p>
                            </div>
                         </div>
                         <p className="text-lg font-black text-primary-500 tracking-tighter">84%</p>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-primary-500/5 border border-primary-500/10 rounded-2xl">
                         <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-500"><Zap size={18}/></div>
                            <div>
                               <p className="text-[11px] font-black text-light-900 dark:text-white tracking-widest uppercase">Inference Speed</p>
                               <p className="text-[10px] text-light-400 dark:text-slate-500 font-bold">Latency metrics</p>
                            </div>
                         </div>
                         <p className="text-lg font-black text-primary-500 tracking-tighter">12ms</p>
                      </div>
                   </div>
                </div>
             </Card>
          </div>
        </div>

        {/* Right Column: Global Data Structures */}
        <div className="xl:col-span-4 space-y-8 lg:space-y-10">
          
          {/* Neural Domains */}
          <Card 
            title="Neural Domains" 
            icon={Database} 
            color="blue" 
            count={b.knowledge?.total_topics || 0}
            isOpen={openSections.knowledge}
            onToggle={() => toggleSection('knowledge')}
          >
             <div className="grid grid-cols-1 gap-4 mt-2">
                {b.knowledge?.topics?.map((t, i) => (
                  <div key={t.topic} className="group relative bg-[#F8FAFC] dark:bg-dark-950/40 border border-light-200 dark:border-slate-800/60 p-5 rounded-[1.5rem] hover:border-blue-500/50 transition-all duration-300 flex items-center justify-between overflow-hidden shadow-sm">
                    <div className="flex items-center gap-4 relative z-10">
                      <div onClick={() => setViewingKnowledgeTopic(t.topic)} className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 cursor-pointer hover:bg-blue-600 hover:text-white transition-all shadow-inner">
                        <Book size={20} />
                      </div>
                      <div className="cursor-pointer" onClick={() => setViewingKnowledgeTopic(t.topic)}>
                        <p className="text-base font-black text-light-900 dark:text-white capitalize tracking-tight">{t.topic}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                           <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                           <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">{t.count} Chunks</p>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => deleteKnowledgeTopic(t.topic)} className="p-2.5 relative z-10 text-light-300 dark:text-slate-700 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all">
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
             </div>
          </Card>

          {/* Preferences */}
          <Card 
            title="Active Preferences" 
            icon={User} 
            color="primary" 
            isOpen={openSections.preferences}
            onToggle={() => toggleSection('preferences')}
          >
             <div className="space-y-4 mt-2">
                {Object.entries(b.preferences || {}).filter(([k]) => !k.startsWith('_')).length > 0 ? (
                  Object.entries(b.preferences || {}).filter(([k]) => !k.startsWith('_')).map(([k, v], i) => (
                    <div key={k} className="group relative p-5 bg-[#F8FAFC] dark:bg-dark-950/40 border border-light-200 dark:border-slate-800/60 rounded-[1.5rem] hover:border-primary-500/50 transition-all duration-300">
                        <div className="flex items-center justify-between mb-2">
                           <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.2em]">{k}</span>
                           <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              <button onClick={() => setEditingPreference({key: k, value: v})} className="p-1.5 text-primary-400 hover:text-primary-600 transition-colors"><Edit3 size={14}/></button>
                              <button onClick={() => deletePreference(k)} className="p-1.5 text-red-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                           </div>
                        </div>
                        {editingPreference?.key === k ? (
                           <div className="flex gap-2 mt-2 animate-slide-in">
                              <input value={editingPreference.value} onChange={e => setEditingPreference({...editingPreference, value: e.target.value})}
                                 className="flex-1 bg-white dark:bg-dark-900 border border-primary-500/50 rounded-xl px-4 py-2 text-xs text-light-900 dark:text-white outline-none focus:ring-2 ring-primary-500/10 shadow-inner" />
                              <button onClick={() => savePreference(editingPreference.key, editingPreference.value)} className="bg-primary-600 text-white p-2 rounded-xl hover:bg-primary-500 shadow-lg shadow-primary-600/20 transition-all"><CheckCircle2 size={16}/></button>
                              <button onClick={() => setEditingPreference(null)} className="text-light-400 p-2"><X size={16}/></button>
                           </div>
                        ) : (
                           <p className="text-sm font-bold text-light-900 dark:text-slate-200">{v}</p>
                        )}
                    </div>
                  ))
                ) : (
                  <div className="p-10 text-center border-2 border-dashed border-light-200 dark:border-slate-800 rounded-[2rem] opacity-30">
                    <p className="text-xs font-bold uppercase tracking-widest">No neural filters active</p>
                  </div>
                )}
             </div>
          </Card>

        </div>
      </div>

      {/* Overlays */}
      {showTeach && <TeachModal onClose={() => setShowTeach(false)} onTeach={fetchData} />}
      {viewingKnowledgeTopic && <KnowledgeModal topic={viewingKnowledgeTopic} onClose={() => setViewingKnowledgeTopic(null)} onUpdate={fetchData} />}
    </div>
  )
}
