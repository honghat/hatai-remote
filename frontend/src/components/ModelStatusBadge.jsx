import { useEffect, useState, useRef } from 'react'
import api from '../api'
import { Cpu, Loader2, Sparkles, ChevronDown, CheckCircle2, Zap, Brain, Server } from 'lucide-react'

export default function ModelStatusBadge({ isCollapsed }) {
  const [status, setStatus] = useState(null)
  const [switching, setSwitching] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  const fetchStatus = async () => {
    try {
      const { data } = await api.get('/ai/status')
      setStatus(data)
    } catch { setStatus(null) }
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 5000)
    
    // Close dropdown on click outside
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    
    return () => {
      clearInterval(id)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleSwitch = async (provider) => {
    if (status?.provider === provider || switching) return
    setSwitching(true)
    try {
      await api.post('/ai/provider', { provider })
      await fetchStatus()
      setIsOpen(false)
    } catch (err) {
      console.error('Switch failed:', err)
    } finally {
      setSwitching(false)
    }
  }

  if (!status) return null

  const activeProvider = status.provider || 'local'
  const isLocal = activeProvider === 'local'
  const isGemini = activeProvider === 'gemini'
  const isOllama = activeProvider === 'ollama'
  const isOpenAI = activeProvider === 'openai'
  
  const localStatus = status.local || {}
  const geminiStatus = status.gemini || {}
  const ollamaStatus = status.ollama || {}
  const openaiStatus = status.openai || {}

  const isReady = activeProvider === 'gemini' ? geminiStatus.ready : activeProvider === 'ollama' ? ollamaStatus.ready : activeProvider === 'openai' ? openaiStatus.ready : localStatus.loaded
  const isLoading = activeProvider === 'local' && localStatus.loading

  const currentModelName = isLocal ? 'Qwen3-4B' : isGemini ? (geminiStatus.model || 'Gemini 2.0 Flash') : isOllama ? 'Ollama' : (openaiStatus.model || 'OpenAI Server')

  return (
    <div className="relative mb-4 px-1" ref={dropdownRef}>
      {!isCollapsed && (
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="text-[10px] uppercase tracking-[0.15em] font-black text-light-500 dark:text-slate-500/80 uppercase tracking-widest">Intelligence Engine</span>
          {switching && (
            <div className="flex items-center gap-1.5 animate-pulse">
              <span className="text-[9px] font-bold text-primary-600 dark:text-primary-500 uppercase">Switching...</span>
              <Loader2 size={10} className="animate-spin text-primary-600 dark:text-primary-500" />
            </div>
          )}
        </div>
      )}
      
      <button 
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
        className={`w-full group relative overflow-hidden transition-all duration-300 text-left 
          ${isCollapsed ? 'rounded-xl p-2 flex justify-center' : 'rounded-2xl px-3 py-3 flex items-center gap-3'} 
          ${isOpen ? 'ring-2 ring-primary-500/20 border-primary-500/40 bg-light-100 dark:bg-slate-900/90' : 'bg-light-50 dark:bg-slate-900/80 hover:border-primary-500/40 border-light-200 dark:border-slate-800/60 shadow-sm dark:shadow-xl'}`}
      >
        {/* Glow effect */}
        <div className={`absolute -inset-1 opacity-0 group-hover:opacity-100 transition-opacity blur-xl duration-500 ${isLocal ? 'bg-primary-500/5' : isGemini ? 'bg-purple-500/5' : isOllama ? 'bg-emerald-500/5' : 'bg-blue-500/5'}`} />
        
        <div className={`relative flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-300 ${
          isCollapsed ? 'w-8 h-8 p-1' : 'w-10 h-10'
        } ${
          isLocal 
            ? 'bg-primary-100 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 group-hover:bg-primary-200 dark:group-hover:bg-primary-500/20 border border-primary-500/20' 
            : isGemini ? 'bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover:bg-purple-200 dark:group-hover:bg-purple-500/20 border border-purple-500/20'
            : isOllama ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-500/20 border border-emerald-500/20'
            : 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-200 dark:group-hover:bg-blue-500/20 border border-blue-500/20'
        }`}>
          {isLocal ? <Brain size={isCollapsed ? 16 : 20} /> : isGemini ? <Sparkles size={isCollapsed ? 16 : 20} /> : isOpenAI ? <Server size={isCollapsed ? 16 : 20} /> : <Cpu size={isCollapsed ? 16 : 20} />}
          
          {/* Status Pip */}
          <div className="absolute -top-1 -right-1">
            <span className="flex h-2.5 w-2.5 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isReady ? 'bg-emerald-500' : isLoading ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 border border-white dark:border-dark-900 ${isReady ? 'bg-emerald-600' : isLoading ? 'bg-yellow-500' : 'bg-red-600'}`}></span>
            </span>
          </div>
        </div>
        
        {!isCollapsed && (
          <div className="relative min-w-0 flex-1">
            <p className="text-sm font-black text-light-900 dark:text-white tracking-tight leading-none mb-1">{currentModelName}</p>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isReady ? 'text-emerald-600/90 dark:text-emerald-400/80' : isLoading ? 'text-yellow-600/90 dark:text-yellow-400/80' : 'text-red-600/90 dark:text-red-400/80'}`}>
                {isReady ? 'Engine Active' : isLoading ? 'Warming Up' : 'Engine Idle'}
              </span>
            </div>
          </div>
        )}
        
        {!isCollapsed && (
          <div className={`relative p-1 rounded-lg bg-light-200 dark:bg-slate-800/40 text-light-400 dark:text-slate-500 group-hover:text-light-900 dark:group-hover:text-slate-300 transition-colors ${isOpen ? 'rotate-180 bg-primary-100 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400' : ''}`}>
             <ChevronDown size={14} className="transition-transform duration-300" />
          </div>
        )}
      </button>

      {isOpen && (
        <div className={`absolute top-[calc(100%+8px)] p-2 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/80 rounded-2xl shadow-2xl z-50 overflow-hidden animate-slide-down backdrop-blur-2xl
          ${isCollapsed ? 'left-0 w-64' : 'left-0 right-0'}`}>
          <div className="space-y-1.5">
            {/* Local Option */}
            <button
              onClick={() => handleSwitch('local')}
              className={`w-full group relative flex items-center gap-3.5 p-3 rounded-xl transition-all duration-300 ${
                isLocal 
                  ? 'bg-primary-50 dark:bg-primary-600/10 border border-primary-500/20' 
                  : 'hover:bg-light-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isLocal ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400' : 'bg-light-200 dark:bg-slate-800 text-light-500 dark:text-slate-500 group-hover:bg-light-300 dark:group-hover:bg-slate-700'}`}>
                <Cpu size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold tracking-tight ${isLocal ? 'text-primary-700 dark:text-primary-400' : 'text-light-700 dark:text-slate-300 group-hover:text-light-900 dark:group-hover:text-white'}`}>Local Qwen3</span>
                  {isLocal && <div className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />}
                </div>
                <p className="text-[10px] text-light-500 dark:text-slate-500 group-hover:text-light-600 dark:group-hover:text-slate-400 truncate">Private & ultra-fast (Metal GPU)</p>
              </div>
              {isLocal && <CheckCircle2 size={16} className="text-primary-600 dark:text-primary-500 flex-shrink-0" />}
            </button>

            {/* Gemini Option */}
            <button
              onClick={() => handleSwitch('gemini')}
              className={`w-full group relative flex items-center gap-3.5 p-3 rounded-xl transition-all duration-300 ${
                isGemini 
                  ? 'bg-purple-50 dark:bg-purple-600/10 border border-purple-500/20' 
                  : 'hover:bg-light-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isGemini ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'bg-light-200 dark:bg-slate-800 text-light-500 dark:text-slate-500 group-hover:bg-light-300 dark:group-hover:bg-slate-700'}`}>
                <Zap size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold tracking-tight ${isGemini ? 'text-purple-700 dark:text-purple-400' : 'text-light-700 dark:text-slate-300 group-hover:text-light-900 dark:group-hover:text-white'}`}>Gemini 2.0</span>
                  {isGemini && <div className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-pulse" />}
                </div>
                <p className="text-[10px] text-light-500 dark:text-slate-500 group-hover:text-light-600 dark:group-hover:text-slate-400 truncate">Max reasoning & API power</p>
              </div>
              {isGemini && <CheckCircle2 size={16} className="text-purple-600 dark:text-purple-500 flex-shrink-0" />}
            </button>

            {/* Ollama Option */}
            <button
              onClick={() => handleSwitch('ollama')}
              className={`w-full group relative flex items-center gap-3.5 p-3 rounded-xl transition-all duration-300 ${
                isOllama 
                  ? 'bg-emerald-50 dark:bg-emerald-600/10 border border-emerald-500/20' 
                  : 'hover:bg-light-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isOllama ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-light-200 dark:bg-slate-800 text-light-500 dark:text-slate-500 group-hover:bg-light-300 dark:group-hover:bg-slate-700'}`}>
                <Cpu size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold tracking-tight ${isOllama ? 'text-emerald-700 dark:text-emerald-400' : 'text-light-700 dark:text-slate-300 group-hover:text-light-900 dark:group-hover:text-white'}`}>Ollama Engine</span>
                  {isOllama && <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                </div>
                <p className="text-[10px] text-light-500 dark:text-slate-500 group-hover:text-light-600 dark:group-hover:text-slate-400 truncate">Connect to Ollama local/server</p>
              </div>
              {isOllama && <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-500 flex-shrink-0" />}
            </button>

            {/* OpenAI Option */}
            <button
              onClick={() => handleSwitch('openai')}
              className={`w-full group relative flex items-center gap-3.5 p-3 rounded-xl transition-all duration-300 ${
                isOpenAI 
                  ? 'bg-blue-50 dark:bg-blue-600/10 border border-blue-500/20' 
                  : 'hover:bg-light-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isOpenAI ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-light-200 dark:bg-slate-800 text-light-500 dark:text-slate-500 group-hover:bg-light-300 dark:group-hover:bg-slate-700'}`}>
                <Server size={20} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold tracking-tight ${isOpenAI ? 'text-blue-700 dark:text-blue-400' : 'text-light-700 dark:text-slate-300 group-hover:text-light-900 dark:group-hover:text-white'}`}>OpenAI / llama.cpp</span>
                  {isOpenAI && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />}
                </div>
                <p className="text-[10px] text-light-500 dark:text-slate-500 group-hover:text-light-600 dark:group-hover:text-slate-400 truncate">Generic OpenAI compatible</p>
              </div>
              {isOpenAI && <CheckCircle2 size={16} className="text-blue-600 dark:text-blue-500 flex-shrink-0" />}
            </button>
          </div>
          
          <div className="mt-2 pt-2 border-t border-light-200 dark:border-slate-800/60 text-center">
             <p className="text-[9px] uppercase tracking-[0.2em] text-light-400 dark:text-slate-500/60 font-black">
               Switch Engine Mode
             </p>
          </div>
        </div>
      )}
    </div>
  )
}
