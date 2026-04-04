import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../api'
import { 
  Book, Loader2, CheckCircle2, AlertCircle, 
  Terminal, Shield, FileText, Sparkles
} from 'lucide-react'

export default function About() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const saveTimeoutRef = useRef(null)

  const fetchReadme = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/readme')
      setContent(res.data.content)
      setDraft(res.data.content)
    } catch (e) {
      console.error("Failed to fetch readme:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReadme() }, [])

  // Autosave Logic (Debounce)
  useEffect(() => {
    if (editing && draft !== content) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      
      saveTimeoutRef.current = setTimeout(() => {
        handleSave(draft)
      }, 3000) // Tự động lưu sau 3 giây ngừng gõ
    }
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current) }
  }, [draft, editing])

  const handleSave = async (dataToSave) => {
    setSaving(true)
    try {
      await api.post('/admin/readme', { content: dataToSave })
      setContent(dataToSave)
      setMessage({ type: 'success', text: 'Đã tự động lưu!' })
      setTimeout(() => setMessage(null), 2000)
    } catch (e) {
      setMessage({ type: 'error', text: 'Lỗi lưu: ' + (e.response?.data?.detail || e.message) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#030711]">
      <Loader2 className="animate-spin text-primary-500" size={40} />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-[#030711]">
      {/* Header */}
      <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-500 shadow-inner">
              <Book size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-light-900 dark:text-white tracking-tight">Tài liệu dự án</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-black text-light-400 dark:text-indigo-400/60 uppercase tracking-widest">
                  {editing ? "Đang chỉnh sửa (Autosave ON)" : "Nháy đúp vào nội dung bên dưới để sửa"}
                </span>
                {editing && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {saving && (
              <div className="flex items-center gap-2 text-indigo-500 animate-pulse font-black text-[10px] tracking-widest uppercase bg-indigo-500/5 px-3 py-1.5 rounded-lg border border-indigo-500/10">
                <Loader2 size={12} className="animate-spin" />
                Đang lưu...
              </div>
            )}
            
            {message && !saving && (
              <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest animate-fade-in flex items-center gap-2 ${
                message.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
              }`}>
                {message.type === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {message.text}
              </div>
            )}

            {editing && (
              <button 
                onClick={() => setEditing(false)}
                className="bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400 px-6 py-2.5 rounded-xl font-black text-[10px] tracking-widest hover:bg-slate-300 dark:hover:bg-white/10 transition-all uppercase"
              >
                Xong
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10">
        <div className="max-w-5xl mx-auto">
          {editing ? (
            <div className="relative group animate-scale-in">
              <div className="absolute top-4 left-4 p-2 bg-indigo-500/10 rounded-lg text-indigo-500 opacity-50 pointer-events-none">
                <Terminal size={14} />
              </div>
              <textarea 
                autoFocus
                value={draft} 
                onChange={e => setDraft(e.target.value)}
                onBlur={() => { if(draft === content) setEditing(false); }}
                className="w-full h-[75vh] bg-white dark:bg-dark-900 border border-indigo-500/20 rounded-[2.5rem] px-10 py-12 md:pl-16 text-sm font-mono text-light-800 dark:text-slate-300 focus:border-indigo-500/50 outline-none transition-all shadow-2xl leading-relaxed custom-scrollbar resize-none"
                placeholder="Nhập nội dung Markdown cho tài liệu dự án..."
              />
            </div>
          ) : (
            <div 
              onDoubleClick={() => setEditing(true)}
              className="relative bg-white dark:bg-dark-900 border border-slate-200 dark:border-slate-800/40 rounded-[3rem] shadow-2xl shadow-indigo-500/5 overflow-hidden group animate-fade-in cursor-text"
              title="Nháy đúp để sửa"
            >
              {/* Decorative side accent */}
              <div className="absolute top-0 left-0 w-2 h-full bg-indigo-500 opacity-20 group-hover:opacity-100 transition-opacity" />
              
              <div className="p-10 md:p-16 prose prose-indigo dark:prose-invert max-w-none 
                prose-headings:font-black prose-headings:tracking-tight
                prose-h1:text-4xl prose-h1:mb-8
                prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-6 prose-h2:border-b prose-h2:border-indigo-500/10 prose-h2:pb-2
                prose-p:text-slate-600 dark:prose-p:text-slate-400 prose-p:leading-relaxed
                prose-li:text-slate-600 dark:prose-li:text-slate-400
                prose-strong:text-indigo-600 dark:prose-strong:text-indigo-400
                prose-code:bg-indigo-500/10 prose-code:text-indigo-500 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-lg prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-slate-900 prose-pre:border prose-pre:border-indigo-500/10 prose-pre:rounded-2xl prose-pre:p-6
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || "# Chào mừng bạn đến với HatAI\n\nTài liệu dự án đang được khởi tạo..."}
                </ReactMarkdown>
              </div>
              
              <div className="bg-indigo-50/50 dark:bg-white/[0.01] px-10 py-6 border-t border-slate-100 dark:border-slate-800/40 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">
                  <span className="flex items-center gap-1.5 text-indigo-500/50">
                    <Sparkles size={12} /> Double-Click to Edit
                  </span>
                </div>
                <div className="flex items-center gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                   <span className="text-[10px] font-black text-emerald-500 uppercase">Synced with Root</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
