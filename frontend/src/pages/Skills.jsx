import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api'
import {
  Puzzle, Plus, Trash2, RefreshCw, Play, Edit3, X,
  CheckCircle2, AlertCircle, Loader2, Code2, ToggleLeft, ToggleRight,
  Zap, ChevronDown, ChevronRight, Copy, Terminal, Eye, Save,
  FileCode2, Settings, Tag, BookOpen, Box, Globe, Monitor,
  Brain, MessageCircle, FolderOpen, Search, Wrench
} from 'lucide-react'

// ── Code Editor with line numbers ──────────────────────────────────────

function CodeEditor({ value, onChange, readOnly = false }) {
  const textareaRef = useRef(null)
  const lineNumbersRef = useRef(null)

  const lines = (value || '').split('\n')
  const lineCount = lines.length

  const syncScroll = () => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  return (
    <div className="relative flex bg-dark-950 rounded-2xl border border-slate-800/60 overflow-hidden font-mono text-sm">
      {/* Line numbers */}
      <div
        ref={lineNumbersRef}
        className="flex-shrink-0 py-4 px-2 text-right select-none overflow-hidden bg-dark-950/80 border-r border-slate-800/40"
        style={{ width: '3.5rem' }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="text-slate-600 leading-6 text-xs px-1">
            {i + 1}
          </div>
        ))}
      </div>
      {/* Code area */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        readOnly={readOnly}
        spellCheck={false}
        className="flex-1 bg-transparent text-emerald-300 p-4 resize-none outline-none leading-6 min-h-[300px] placeholder:text-slate-600"
        style={{ tabSize: 4 }}
        placeholder={`"""
Skill Template — define a run(args) function.
"""

def run(args: dict) -> dict:
    """Entry point called by the Agent."""
    name = args.get("name", "World")
    return {"result": f"Hello, {name}!"}`}
      />
    </div>
  )
}

// ── Skill Card ─────────────────────────────────────────────────────────

function SkillCard({ skill, onEdit, onDelete, onToggle, onReload, onTest }) {
  const isLoaded = skill.status === 'loaded'
  const isError = skill.status === 'error'

  return (
    <div className={`group relative bg-white dark:bg-dark-900 border rounded-2xl transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/5
      ${isError ? 'border-red-500/30 dark:border-red-500/20' : skill.enabled ? 'border-light-200 dark:border-slate-800/60' : 'border-light-200/50 dark:border-slate-800/30 opacity-60'}`}>

      {/* Status indicator */}
      <div className={`absolute top-4 right-4 flex items-center gap-2`}>
        {isLoaded && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
        {isError && <span className="w-2 h-2 rounded-full bg-red-500" />}
        {!skill.enabled && <span className="w-2 h-2 rounded-full bg-slate-500" />}
        <span className={`text-[10px] font-bold uppercase tracking-widest
          ${isLoaded ? 'text-emerald-500' : isError ? 'text-red-500' : 'text-slate-500'}`}>
          {skill.status || 'pending'}
        </span>
      </div>

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-3 rounded-2xl flex-shrink-0
            ${isLoaded ? 'bg-primary-500/10' : isError ? 'bg-red-500/10' : 'bg-slate-500/10'}`}>
            <FileCode2 size={22} className={isLoaded ? 'text-primary-500' : isError ? 'text-red-500' : 'text-slate-500'} />
          </div>
          <div className="min-w-0 flex-1 pr-20">
            <h3 className="text-base font-black text-light-900 dark:text-white tracking-tight truncate">{skill.name}</h3>
            <p className="text-xs text-light-400 dark:text-slate-500 mt-1 line-clamp-2">{skill.description}</p>
          </div>
        </div>

        {/* Tool info */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-500/10 text-primary-500 rounded-xl text-xs font-bold">
            <Terminal size={12} />
            {skill.tool_name}
          </span>
          {skill.parameters && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-500/10 text-primary-500 rounded-xl text-xs font-bold">
              <Tag size={12} />
              {'{' + skill.parameters + '}'}
            </span>
          )}
        </div>

        {/* Error message */}
        {isError && skill.error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-xs text-red-400 font-mono break-all">{skill.error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-light-100 dark:border-slate-800/40">
          <button onClick={() => onToggle(skill.id)}
            className={`p-2 rounded-xl transition-all ${skill.enabled ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-slate-500 hover:bg-slate-500/10'}`}
            title={skill.enabled ? 'Disable' : 'Enable'}>
            {skill.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          <button onClick={() => onEdit(skill)}
            className="p-2 rounded-xl text-light-400 dark:text-slate-500 hover:text-primary-500 hover:bg-primary-500/10 transition-all"
            title="Edit">
            <Edit3 size={16} />
          </button>
          <button onClick={() => onReload(skill.id)}
            className="p-2 rounded-xl text-light-400 dark:text-slate-500 hover:text-blue-500 hover:bg-blue-500/10 transition-all"
            title="Reload">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => onTest(skill)}
            className="p-2 rounded-xl text-light-400 dark:text-slate-500 hover:text-amber-500 hover:bg-amber-500/10 transition-all"
            title="Test">
            <Play size={16} />
          </button>
          <div className="flex-1" />
          <button onClick={() => onDelete(skill.id)}
            className="p-2 rounded-xl text-light-400 dark:text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-all"
            title="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create/Edit Modal ──────────────────────────────────────────────────

function SkillModal({ skill, onClose, onSave }) {
  const isEdit = !!skill?.id
  const [form, setForm] = useState({
    name: skill?.name || '',
    description: skill?.description || '',
    tool_name: skill?.tool_name || '',
    parameters: skill?.parameters || '',
    code: skill?.code || `"""
Skill description here.
"""

def run(args: dict) -> dict:
    """Entry point. Receives args dict, returns result dict."""
    return {"result": "Hello from skill!"}
`,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [loadingCode, setLoadingCode] = useState(isEdit && !skill?.code)

  // Load code if editing
  useEffect(() => {
    if (isEdit && !skill?.code) {
      setLoadingCode(true)
      api.get(`/skills/${skill.id}`).then(res => {
        setForm(f => ({ ...f, code: res.data.code || '' }))
      }).catch(() => {}).finally(() => setLoadingCode(false))
    }
  }, [skill?.id])

  const handleSave = async () => {
    if (!form.name.trim() || !form.tool_name.trim() || !form.code.trim()) {
      setError('Name, Tool Name, and Code are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        await api.put(`/skills/${skill.id}`, form)
      } else {
        await api.post('/skills', form)
      }
      onSave()
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-light-200 dark:border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary-500/10 rounded-2xl">
              <FileCode2 size={22} className="text-primary-500" />
            </div>
            <div>
              <h2 className="text-lg font-black text-light-900 dark:text-white tracking-tight">
                {isEdit ? 'Edit Skill' : 'Create New Skill'}
              </h2>
              <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5">
                Define a Python function that the Agent can call
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-light-100 dark:hover:bg-dark-800 rounded-xl transition-all text-light-400 dark:text-slate-500">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Row 1: Name + Tool Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-500 uppercase tracking-widest mb-2">
                Skill Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Weather Checker"
                className="w-full px-4 py-3 bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700/50 rounded-xl text-sm text-light-900 dark:text-white placeholder:text-light-300 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/50 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-500 uppercase tracking-widest mb-2">
                Tool Name <span className="text-light-300 dark:text-slate-600 normal-case">(agent calls this)</span>
              </label>
              <input
                type="text"
                value={form.tool_name}
                onChange={(e) => setForm(f => ({ ...f, tool_name: e.target.value.toLowerCase().replace(/\s/g, '_') }))}
                placeholder="e.g. check_weather"
                className="w-full px-4 py-3 bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700/50 rounded-xl text-sm font-mono text-light-900 dark:text-emerald-400 placeholder:text-light-300 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/50 outline-none transition-all"
              />
            </div>
          </div>

          {/* Row 2: Description */}
          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-500 uppercase tracking-widest mb-2">
              Description
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does this skill do?"
              className="w-full px-4 py-3 bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700/50 rounded-xl text-sm text-light-900 dark:text-white placeholder:text-light-300 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/50 outline-none transition-all"
            />
          </div>

          {/* Row 3: Parameters */}
          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-500 uppercase tracking-widest mb-2">
              Parameters <span className="text-light-300 dark:text-slate-600 normal-case">(comma-separated, shown to LLM)</span>
            </label>
            <input
              type="text"
              value={form.parameters}
              onChange={(e) => setForm(f => ({ ...f, parameters: e.target.value }))}
              placeholder="e.g. city,unit?"
              className="w-full px-4 py-3 bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700/50 rounded-xl text-sm font-mono text-light-900 dark:text-amber-400 placeholder:text-light-300 dark:placeholder:text-slate-600 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/50 outline-none transition-all"
            />
          </div>

          {/* Row 4: Code Editor */}
          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-500 uppercase tracking-widest mb-2">
              Python Code <span className="text-light-300 dark:text-slate-600 normal-case">(must define <code className="text-primary-400">run(args: dict) -&gt; dict</code>)</span>
            </label>
            {loadingCode ? (
              <div className="flex items-center justify-center h-[300px] bg-dark-950 rounded-2xl border border-slate-800/60">
                <Loader2 size={24} className="animate-spin text-slate-500" />
              </div>
            ) : (
              <CodeEditor
                value={form.code}
                onChange={(code) => setForm(f => ({ ...f, code }))}
              />
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-light-200 dark:border-slate-800/60">
          <button onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white transition-all rounded-xl hover:bg-light-100 dark:hover:bg-dark-800">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2.5 text-sm font-bold bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-lg shadow-primary-600/20 transition-all disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isEdit ? 'Save Changes' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Test Modal ─────────────────────────────────────────────────────────

function TestModal({ skill, onClose }) {
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      const args = JSON.parse(argsText)
      const res = await api.post(`/skills/${skill.id}/test`, { args })
      setResult(res.data)
    } catch (e) {
      setResult({ success: false, error: e.response?.data?.detail || e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-[2rem] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-light-200 dark:border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 rounded-xl">
              <Play size={20} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-black text-light-900 dark:text-white tracking-tight">Test: {skill.name}</h3>
              <p className="text-xs text-light-400 dark:text-slate-500 font-mono mt-0.5">{skill.tool_name}({skill.parameters || ''})</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-light-100 dark:hover:bg-dark-800 rounded-xl transition-all text-light-400 dark:text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-500 uppercase tracking-widest mb-2">
              Test Arguments (JSON)
            </label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full px-4 py-3 bg-dark-950 border border-slate-800/60 rounded-xl text-sm font-mono text-emerald-300 placeholder:text-slate-600 focus:ring-2 focus:ring-primary-500/30 outline-none resize-none"
              placeholder='{"key": "value"}'
            />
          </div>

          <button onClick={handleTest} disabled={testing}
            className="w-full py-3 text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Run Test
          </button>

          {result && (
            <div className={`p-4 rounded-xl border ${result.success !== false ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.success !== false ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <AlertCircle size={16} className="text-red-500" />
                )}
                <span className={`text-xs font-bold uppercase tracking-widest ${result.success !== false ? 'text-emerald-500' : 'text-red-500'}`}>
                  {result.success !== false ? 'Success' : 'Error'}
                </span>
              </div>
              <pre className="text-xs font-mono text-light-600 dark:text-slate-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {JSON.stringify(result.result || result.error || result, null, 2)}
              </pre>
              {result.traceback && (
                <pre className="mt-2 text-xs font-mono text-red-400 whitespace-pre-wrap max-h-32 overflow-y-auto border-t border-red-500/20 pt-2">
                  {result.traceback}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  FILE: { icon: FolderOpen, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'File Operations' },
  SEARCH: { icon: Search, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Search' },
  BROWSER: { icon: Globe, color: 'text-cyan-500', bg: 'bg-cyan-500/10', label: 'Browser' },
  DESKTOP: { icon: Monitor, color: 'text-purple-500', bg: 'bg-purple-500/10', label: 'Desktop' },
  AI_CODING: { icon: Code2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'AI Coding' },
  MEMORY: { icon: Brain, color: 'text-pink-500', bg: 'bg-pink-500/10', label: 'Memory' },
  SOCIAL: { icon: MessageCircle, color: 'text-primary-500', bg: 'bg-primary-500/10', label: 'Social' },
  OTHER: { icon: Wrench, color: 'text-slate-400', bg: 'bg-slate-500/10', label: 'Other' },
  OFFICE: { icon: FileCode2, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Office Suite' },
  PDF: { icon: FileCode2, color: 'text-red-500', bg: 'bg-red-500/10', label: 'PDF' },
}

function BuiltinToolsSection() {
  const [categories, setCategories] = useState({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [showMore, setShowMore] = useState({}) // category -> bool
  const [pinnedTools, setPinnedTools] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('hatai_pinned_tools') || '[]')
    } catch { return [] }
  })

  useEffect(() => {
    api.get('/skills/builtin/list').then(res => {
      setCategories(res.data.categories || {})
      setTotal(res.data.total || 0)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    localStorage.setItem('hatai_pinned_tools', JSON.stringify(pinnedTools))
  }, [pinnedTools])

  const toggleCat = (cat) => setExpanded(e => ({ ...e, [cat]: !e[cat] }))
  const toggleShowMore = (cat) => setShowMore(s => ({ ...s, [cat]: !s[cat] }))
  
  const togglePin = (toolName) => {
    setPinnedTools(prev => prev.includes(toolName) 
      ? prev.filter(t => t !== toolName) 
      : [...prev, toolName]
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={32} className="animate-spin text-primary-500/50" />
    </div>
  )

  const allToolsFlat = Object.values(categories).flat()
  const pinnedList = allToolsFlat.filter(t => pinnedTools.includes(t.tool_name))

  const filteredCategories = {}
  let visibleTotal = 0
  
  Object.entries(categories).forEach(([cat, tools]) => {
    const filtered = tools.filter(t => 
      t.tool_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.parameters || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
    if (filtered.length > 0) {
      filteredCategories[cat] = filtered
      visibleTotal += filtered.length
    }
  })

  const ITEM_LIMIT = 12

  const ToolCard = ({ tool, config }) => (
    <div className="group relative flex flex-col p-5 bg-white dark:bg-dark-950/60 border border-light-100 dark:border-slate-800/40 rounded-[1.5rem] hover:border-primary-500/40 transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl ${config.bg} bg-opacity-50`}>
            <Terminal size={14} className={config.color} />
          </div>
          <p className="text-[13px] font-black text-light-900 dark:text-emerald-400 font-mono tracking-tight">{tool.tool_name}</p>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); togglePin(tool.tool_name) }}
          className={`p-1.5 rounded-lg transition-all ${pinnedTools.includes(tool.tool_name) ? 'text-primary-500 bg-primary-500/10' : 'text-light-300 dark:text-slate-700 hover:text-primary-400 opacity-0 group-hover:opacity-100'}`}
        >
          <Tag size={14} fill={pinnedTools.includes(tool.tool_name) ? 'currentColor' : 'none'} />
        </button>
      </div>
      
      {tool.parameters && (
        <p className="text-[10px] text-amber-500/80 dark:text-amber-400/60 font-mono mb-2.5 bg-amber-500/5 px-2.5 py-1.5 rounded-xl truncate border border-amber-500/10">
          {'{' + tool.parameters + '}'}
        </p>
      )}
      
      {tool.description && (
        <p className="text-[11px] text-light-500 dark:text-slate-400 leading-relaxed font-medium line-clamp-2 italic group-hover:line-clamp-none transition-all">
          {tool.description}
        </p>
      )}
    </div>
  )

  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-[2.5rem] overflow-hidden shadow-sm">
      <div className="p-8 pb-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-5">
            <div className="p-4 rounded-[1.5rem] bg-primary-500/10 shadow-lg shadow-primary-500/5">
              <Box size={24} className="text-primary-500" />
            </div>
            <div>
              <h3 className="text-xl font-black text-light-900 dark:text-white tracking-tight">Công cụ Tích hợp</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-[0.2em]">
                  {total} công cụ | {visibleTotal} hiển thị
                </span>
              </div>
            </div>
          </div>

          <div className="relative group max-w-md w-full">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-light-300 dark:text-slate-600 group-focus-within:text-primary-500 transition-colors" size={20} />
            <input 
              type="text"
              placeholder="Tìm kiếm công cụ, tham số..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-14 pr-5 py-4 bg-light-50 dark:bg-dark-950 border border-light-100 dark:border-slate-800/60 rounded-[1.5rem] text-sm outline-none focus:border-primary-500/50 transition-all shadow-inner"
            />
          </div>
        </div>

        {/* Pinned Section */}
        {pinnedList.length > 0 && searchQuery.length === 0 && (
          <div className="mb-10 animate-fade-in">
             <div className="flex items-center gap-3 mb-5 px-1">
                <div className="w-1.5 h-6 bg-primary-500 rounded-full" />
                <h4 className="text-xs font-black text-light-400 dark:text-slate-500 uppercase tracking-[0.3em]">Công cụ Đã ghim</h4>
             </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {pinnedList.map((tool, i) => (
                   <ToolCard key={`pinned-${i}`} tool={tool} config={CATEGORY_CONFIG[tool.category] || CATEGORY_CONFIG.OTHER} />
                ))}
             </div>
          </div>
        )}
      </div>

      <div className="px-8 pb-8 space-y-4">
        {Object.entries(filteredCategories).map(([cat, tools]) => {
          const config = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.OTHER
          const Icon = config.icon
          const isExp = expanded[cat] || searchQuery.length > 0
          const isShowAll = showMore[cat] || searchQuery.length > 0
          const displayedTools = isShowAll ? tools : tools.slice(0, ITEM_LIMIT)

          return (
            <div key={cat} className={`border rounded-[2rem] transition-all duration-500 ${isExp ? 'border-primary-500/20 bg-primary-500/[0.02]' : 'border-light-100 dark:border-slate-800/40 hover:border-light-200 dark:hover:border-slate-700/60'}`}>
              <button
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-4 px-6 py-5 transition-all group"
              >
                <div className={`p-3 rounded-2xl transition-transform group-hover:scale-110 shadow-lg shadow-black/5 ${config.bg}`}>
                  <Icon size={20} className={config.color} />
                </div>
                <div className="flex-1 text-left">
                  <span className="text-sm font-black text-light-900 dark:text-white block tracking-tight">{config.label}</span>
                  <span className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">{tools.length} công cụ</span>
                </div>
                <div className="flex items-center gap-3">
                   {isExp ? <ChevronDown size={20} className="text-light-300" /> : <ChevronRight size={20} className="text-light-300" />}
                </div>
              </button>

              {isExp && (
                <div className="px-6 pb-6 animate-slide-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {displayedTools.map((tool, i) => (
                      <ToolCard key={i} tool={tool} config={config} />
                    ))}
                  </div>
                  
                  {tools.length > ITEM_LIMIT && searchQuery.length === 0 && (
                    <div className="mt-8 flex justify-center">
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleShowMore(cat) }}
                        className="flex items-center gap-2 px-8 py-3 bg-white dark:bg-dark-800 hover:bg-primary-600 hover:text-white border border-light-200 dark:border-slate-700/60 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg hover:shadow-primary-600/20 active:scale-95"
                      >
                        {isShowAll ? 'Thu gọn' : `Xem thêm (${tools.length - ITEM_LIMIT} công cụ)`}
                        {isShowAll ? <ChevronDown size={14} className="rotate-180" /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Skills() {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [editSkill, setEditSkill] = useState(null)     // null = closed, {} = new, skill = edit
  const [testSkill, setTestSkill] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const fetchSkills = useCallback(async () => {
    try {
      const res = await api.get('/skills')
      setSkills(res.data.skills || [])
    } catch (e) {
      console.error('Failed to load skills:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  const handleToggle = async (id) => {
    try {
      await api.post(`/skills/${id}/toggle`)
      fetchSkills()
    } catch (e) {
      console.error('Toggle failed:', e)
    }
  }

  const handleReload = async (id) => {
    try {
      await api.post(`/skills/${id}/reload`)
      fetchSkills()
    } catch (e) {
      console.error('Reload failed:', e)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this skill permanently?')) return
    setDeleting(id)
    try {
      await api.delete(`/skills/${id}`)
      fetchSkills()
    } catch (e) {
      console.error('Delete failed:', e)
    } finally {
      setDeleting(null)
    }
  }

  const handleEditClick = async (skill) => {
    // Fetch full skill with code
    try {
      const res = await api.get(`/skills/${skill.id}`)
      setEditSkill(res.data)
    } catch {
      setEditSkill(skill)
    }
  }

  const loadedCount = skills.filter(s => s.status === 'loaded').length
  const errorCount = skills.filter(s => s.status === 'error').length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-primary-500/10 rounded-xl shadow-lg shadow-primary-500/5">
              <Puzzle size={24} className="text-primary-500" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">Công cụ Trí nhớ Agent</h1>
              <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5 font-bold uppercase tracking-widest">
                Custom Python tools & Built-in sensors
              </p>
            </div>
          </div>
          <button onClick={() => setEditSkill({})}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-primary-600/20 transition-all active:scale-95">
            <Plus size={16} />
            Tạo mới
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white dark:bg-dark-900/60 border border-light-200 dark:border-slate-800/60 p-5 rounded-2xl flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary-500/10">
              <Puzzle size={20} className="text-primary-500" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">Tổng</p>
              <p className="text-xl font-black text-light-900 dark:text-white">{skills.length}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-dark-900/60 border border-light-200 dark:border-slate-800/60 p-5 rounded-2xl flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-emerald-500/10">
              <Zap size={20} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">Hoạt động</p>
              <p className="text-xl font-black text-emerald-500">{loadedCount}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-dark-900/60 border border-light-200 dark:border-slate-800/60 p-5 rounded-2xl flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-red-500/10">
              <AlertCircle size={20} className="text-red-500" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">Lỗi</p>
              <p className="text-xl font-black text-red-500">{errorCount}</p>
            </div>
          </div>
        </div>

        {/* Skills Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={32} className="animate-spin text-primary-500" />
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex p-6 bg-light-100 dark:bg-dark-800 rounded-3xl mb-6">
              <Puzzle size={48} className="text-light-300 dark:text-slate-600" />
            </div>
            <h3 className="text-lg font-black text-light-900 dark:text-white tracking-tight mb-2">Chưa có kỹ năng nào</h3>
            <p className="text-sm text-light-400 dark:text-slate-500 max-w-md mx-auto mb-6">
              Tạo kỹ năng tuỳ chỉnh đầu tiên để mở rộng khả năng của Agent. Viết hàm Python và Agent sẽ tự gọi nó trong hội thoại.
            </p>
            <button onClick={() => setEditSkill({})}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-primary-600/20 transition-all">
              <Plus size={18} />
              Tạo Kỹ năng Đầu tiên
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {skills.map(skill => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onEdit={handleEditClick}
                onDelete={handleDelete}
                onToggle={handleToggle}
                onReload={handleReload}
                onTest={() => setTestSkill(skill)}
              />
            ))}
          </div>
        )}

        {/* Built-in Tools */}
        <BuiltinToolsSection />

        {/* How it works */}
        <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <BookOpen size={20} className="text-primary-500" />
            <h3 className="font-bold text-light-900 dark:text-white">Cách hoạt động</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-light-500 dark:text-slate-400">
            <div className="space-y-2">
              <p className="font-bold text-light-700 dark:text-slate-300">1. Định nghĩa</p>
              <p>Viết file Python với hàm <code className="text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded">run(args: dict) -&gt; dict</code>. Agent sẽ gọi hàm này với các tham số tương ứng.</p>
            </div>
            <div className="space-y-2">
              <p className="font-bold text-light-700 dark:text-slate-300">2. Đăng ký</p>
              <p>Đặt <strong>tên công cụ</strong> và <strong>tham số</strong>. Thông tin này được hiển thị cho LLM để biết khi nào và cách gọi kỹ năng.</p>
            </div>
            <div className="space-y-2">
              <p className="font-bold text-light-700 dark:text-slate-300">3. Sử dụng</p>
              <p>Agent sẽ tự động sử dụng kỹ năng khi phù hợp với tác vụ. Bạn cũng có thể test trước tại đây.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {editSkill !== null && (
        <SkillModal
          skill={editSkill.id ? editSkill : null}
          onClose={() => setEditSkill(null)}
          onSave={() => { setEditSkill(null); fetchSkills() }}
        />
      )}
      {testSkill && (
        <TestModal
          skill={testSkill}
          onClose={() => setTestSkill(null)}
        />
      )}
      </div>
    </div>
  )
}
