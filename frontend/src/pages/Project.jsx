import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import api, { codeApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import Editor from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs/components/prism-core'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import 'prismjs/themes/prism-tomorrow.css'
import ModelStatusBadge from '../components/ModelStatusBadge'
import { 
  FileCode, Search, ChevronRight, Activity,
  Wand2, Copy, Save, X, History, Settings, Brain, Trash2,
  Sparkles, ChevronDown, Monitor, RotateCcw, Plus, Mic, ArrowRight,
  GitBranch, ExternalLink, Cpu, Zap, Server, BrainCircuit,
  Image as ImageIcon, AtSign, SquareSlash, Menu, LogOut, Code2, ListTodo, Clock, Puzzle, Bot, Sun, Moon,
  MessageSquare, Link2
} from 'lucide-react'

const NAV_ITEMS = [
  { path: '/chat', label: 'AI Agent', icon: Zap },
  { path: '/tasks', label: 'Background Tasks', icon: ListTodo },
  { path: '/schedules', label: 'Tác vụ Định kỳ', icon: Clock },
  { path: '/terminal', label: 'SSH Terminal', icon: Monitor },
  { path: '/project', label: 'HatAI Code', icon: Code2 },
  { path: '/skills', label: 'Agent Skills', icon: Puzzle },
  { path: '/brain', label: 'Brain & Memory', icon: Brain },
]

export default function Project() {
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const isDark = theme === 'dark'
  const navigate = useNavigate()
  const location = useLocation()

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [files, setFiles] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [activeSidebarView, setActiveSidebarView] = useState('explorer')
  
  const [openTabs, setOpenTabs] = useState(() => JSON.parse(localStorage.getItem('hatai_open_tabs') || '[]'))
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('hatai_active_tab'))
  const [editingContents, setEditingContents] = useState({})
  const [proposingContents, setProposingContents] = useState({}) // NEW: For live AI streaming to editor
  const [originalContents, setOriginalContents] = useState({}) 
  const [sessions, setSessions] = useState([]) // NEW: Past sessions list
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem('hatai_session_id'))
  const [gitStatus, setGitStatus] = useState({ branch: '', files: [] }) // NEW: Git state
  const [gitProfile, setGitProfile] = useState({ name: '', email: '' }) // NEW: Git profile
  const [isGitInit, setIsGitInit] = useState(true) // Assume initialized until check
  const [githubUrl, setGithubUrl] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [gitLoading, setGitLoading] = useState(false)
  const [saving, setSaving] = useState({})
  const [showCheatSheet, setShowCheatSheet] = useState(false) // Toggle for Git commands
  const [aiInstructions, setAiInstructions] = useState({})
  const [editingWithAi, setEditingWithAi] = useState({})
  const [pendingChanges, setPendingChanges] = useState({}) 
  const [openFolders, setOpenFolders] = useState(new Set(['backend', 'frontend']))
  const [isEditingRemote, setIsEditingRemote] = useState(false) // NEW: Toggle for remote input UI
  
  const [showChat, setShowChat] = useState(true)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState(() => JSON.parse(localStorage.getItem('hatai_project_chat') || '[]'))
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [selectedModel, setSelectedModel] = useState('OpenAI Server') 
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [attachments, setAttachments] = useState([]) 
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const chatInputRef = useRef(null)
  const chatScrollRef = useRef(null)

  const availableModels = [
    { id: 'openai', name: 'OpenAI Server', icon: Server, desc: 'Generic API' },
    { id: 'gemini', name: 'Gemini 2.0', icon: Zap, desc: 'Max Reasoning Power' },
    { id: 'local', name: 'Local Qwen3', icon: Brain, desc: 'Ultra-fast Metal GPU' },
    { id: 'ollama', name: 'Ollama Engine', icon: Cpu, desc: 'Local/Remote Server' }
  ]

  useEffect(() => {
    localStorage.setItem('hatai_open_tabs', JSON.stringify(openTabs))
  }, [openTabs])
  useEffect(() => {
    if (activeTab) localStorage.setItem('hatai_active_tab', activeTab)
  }, [activeTab])
  useEffect(() => {
    localStorage.setItem('hatai_project_chat', JSON.stringify(chatMessages))
  }, [chatMessages])
  useEffect(() => {
    if (activeSessionId) localStorage.setItem('hatai_session_id', activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    fetchFiles()
    fetchSessions()
    fetchGitStatus()
    const timer = setInterval(() => { 
        fetchLogs()
        fetchGitStatus() // Auto-poll git status for "Always Connected" state
    }, 10000)
    return () => clearInterval(timer)
  }, [])

  const fetchFiles = async () => {
    setLoading(true)
    try {
      const resp = await codeApi.get('/code/scan')
      setFiles(resp.data.files || [])
      setError(null)
    } catch (err) { setError('Connection Error'); } finally { setLoading(false); }
  }

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 60) return 'Just Now'
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`
    return new Date(date).toLocaleDateString()
  }

  const fetchSessions = async () => {
    try {
        const resp = await api.get('/ai/sessions')
        setSessions(resp.data || [])
    } catch (err) {}
  }

  const fetchGitStatus = async () => {
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote" // Corrected root for HatAI Remote repo
        
        // Check if git is initialized
        const checkInit = await codeApi.post('/code/execute', { command: '[ -d .git ] && echo "YES" || echo "NO"', cwd: rootDir })
        const initialised = checkInit.data.stdout.trim() === 'YES'
        setIsGitInit(initialised)
        
        if (!initialised) {
            setGitLoading(false)
            return
        }

        const [branchResp, statusResp, nameResp, emailResp, remoteResp] = await Promise.all([
            codeApi.post('/code/execute', { command: 'git branch --show-current', cwd: rootDir }),
            codeApi.post('/code/execute', { command: 'git status --porcelain', cwd: rootDir }),
            codeApi.post('/code/execute', { command: 'git config user.name', cwd: rootDir }),
            codeApi.post('/code/execute', { command: 'git config user.email', cwd: rootDir }),
            codeApi.post('/code/execute', { command: 'git remote get-url origin || echo ""', cwd: rootDir })
        ])
        
        const branch = branchResp.data.stdout.trim()
        const files = statusResp.data.stdout.split('\n').filter(l => l.trim()).map(line => {
            const status = line.substring(0, 2).trim()
            const file = line.substring(3)
            return { file, status }
        })
        setGitStatus({ branch, files })
        setGitProfile({ name: nameResp.data.stdout.trim(), email: emailResp.data.stdout.trim() })
        setGithubUrl(remoteResp.data.stdout.trim())
    } catch (err) {} finally { setGitLoading(false) }
  }

  const GIT_PRESETS = [
    { label: 'Feat', emoji: '🔥', text: 'feat: add feature' },
    { label: 'Fix', emoji: '🐛', text: 'fix: resolve issue' },
    { label: 'Refactor', emoji: '♻️', text: 'refactor: clean logic' },
    { label: 'Docs', emoji: '📝', text: 'docs: update readme' },
    { label: 'Hotfix', emoji: '⚡', text: 'hotfix: critical patch' }
  ]

  const handleGitCommit = async () => {
     if (!commitMessage.trim()) return
     setGitLoading(true)
     try {
         const rootDir = "/Users/nguyenhat/Public/hatai-remote"
         await codeApi.post('/code/execute', { command: `git add . && git commit -m "${commitMessage}"`, cwd: rootDir })
         setCommitMessage('')
         fetchGitStatus()
     } catch (err) { console.error('Commit Failed', err) } finally { setGitLoading(false) }
  }

  const handleGitInit = async () => {
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        await codeApi.post('/code/execute', { command: 'git init && git add . && git commit -m "initial commit"', cwd: rootDir })
        if (githubUrl.trim()) {
            await codeApi.post('/code/execute', { command: `git remote add origin ${githubUrl}`, cwd: rootDir })
        }
        fetchGitStatus()
    } catch (err) { console.error('Init Failed', err) } finally { setGitLoading(false) }
  }

  const handleGitSync = async () => {
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        const branch = gitStatus.branch || 'main'
        await codeApi.post('/code/execute', { command: `git push origin ${branch}`, cwd: rootDir })
        fetchGitStatus()
    } catch (err) { console.error('Sync Failed', err) } finally { setGitLoading(false) }
  }

  const handleGitConnectRemote = async () => {
    if (!githubUrl.trim()) return
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        // Try adding, if fails (exists), try setting
        await codeApi.post('/code/execute', { command: `git remote add origin ${githubUrl} || git remote set-url origin ${githubUrl}`, cwd: rootDir })
        fetchGitStatus()
    } catch (err) { console.error('Failed to update remote', err) } finally { setGitLoading(false) }
  }

  const handleLoadSession = async (id) => {
    setActiveSessionId(id)
    try {
        const resp = await api.get(`/ai/sessions/${id}/messages`)
        setChatMessages(resp.data || [])
        setShowChat(true)
    } catch (err) { alert('Failed to load session history') }
  }

  const handleDeleteSession = async (e, id) => {
    e.stopPropagation()
    // Instant deletion as requested
    try {
        await api.delete(`/ai/sessions/${id}`)
        setSessions(prev => prev.filter(s => s.id !== id))
        if (activeSessionId == id) {
            setActiveSessionId(null)
            setChatMessages([])
            localStorage.removeItem('hatai_session_id')
            localStorage.removeItem('hatai_project_chat')
        }
    } catch (err) { alert('Failed to delete session') }
  }

  const handleNewChat = () => {
    setActiveSessionId(null)
    setChatMessages([])
    localStorage.removeItem('hatai_session_id')
    localStorage.removeItem('hatai_project_chat')
    setShowChat(true)
  }

  const [systemLogs, setSystemLogs] = useState([])
  const fetchLogs = async () => {
    try {
        const [logResp, msgResp] = await Promise.all([
          api.get('/ai/logs'),
          api.get('/ai/sessions') // Get latest thoughts from database
        ])
        const recentLogs = logResp.data.logs || []
        
        // Find most recent session with thoughts
        const latestSession = msgResp.data[0]
        let recentThoughts = []
        if (latestSession) {
            const msgs = await api.get(`/ai/sessions/${latestSession.id}/messages`)
            recentThoughts = msgs.data.filter(m => m.role === 'assistant' && m.thoughts).slice(-3).map(m => `[THOUGHT] ${m.thoughts.replace(/<\/?think>/gi,'').substring(0, 150)}...`)
        }
        
        setSystemLogs([...recentThoughts, ...recentLogs.slice(-20)])
    } catch (err) { console.error('Log sync failed') }
  }

  const handleOpenFile = async (path) => {
    if (!openTabs.includes(path)) setOpenTabs(prev => [...prev, path])
    setActiveTab(path)
    if (!editingContents[path]) {
      try {
        const file = files.find(f => f.path === path)
        const resp = await codeApi.post('/code/read', { path: file.full_path })
        setEditingContents(prev => ({ ...prev, [path]: resp.data.content }))
        setOriginalContents(prev => ({ ...prev, [path]: resp.data.content }))
      } catch (err) { }
    }
  }

  const handleSaveFile = async (path) => {
    setSaving(prev => ({ ...prev, [path]: true }))
    try {
      const fullPath = files.find(f => f.path === path).full_path
      await codeApi.post('/code/write', { path: fullPath, content: editingContents[path], change_summary: 'Cloud Sync' })
      setOriginalContents(prev => ({ ...prev, [path]: editingContents[path] }))
      setPendingChanges(prev => ({ ...prev, [path]: false }))
      
      // AUTO-PUSH PROTOCOL
      const rootDir = "/Users/nguyenhat/Public/hatai-remote"
      // Non-blocking attempt to sync
      codeApi.post('/code/execute', { 
         command: `git add . && git commit -m "Auto-sync: ${path.split('/').pop()}" && (git push origin main || git push origin master || true)`, 
         cwd: rootDir 
      }).then(() => fetchGitStatus())
    } catch (err) { } finally { setSaving(prev => ({ ...prev, [path]: false })); }
  }

  const handleAIEdit = async () => {
    if (!activeTab || !aiInstructions[activeTab]?.trim()) return
    const path = activeTab
    setEditingWithAi(prev => ({ ...prev, [path]: true }))
    try {
        const fullPath = files.find(f => f.path === path).full_path
        const resp = await codeApi.post('/code/ai-edit', { path: fullPath, instruction: aiInstructions[path], current_code: editingContents[path], model: selectedModel })
        setEditingContents(prev => ({ ...prev, [path]: resp.data.modified_code }))
        setAiInstructions(prev => ({ ...prev, [path]: '' }))
        setPendingChanges(prev => ({ ...prev, [path]: true }))
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Updated logic for ${path.split('/').pop()}. Please review and accept below.`, meta: { files: [path], type: 'edit' } }])
    } catch (err) { } finally { setEditingWithAi(prev => ({ ...prev, [path]: false })); }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setIsUploadingMedia(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
        const resp = await api.post('/ai/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
        setAttachments(prev => [...prev, resp.data])
        setIsContextOpen(false) // Auto-close menu
    } catch (err) { alert('Upload failed') } finally { setIsUploadingMedia(false) }
  }

  const handleSendChat = async () => {
    if (!chatInput.trim() || isChatStreaming) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setAttachments([]) // Clear current staging
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg, attachments: [...attachments] }])
    
    // PREPEND active file context for higher priority in LLM attention
    const contextPrefix = activeTab && editingContents[activeTab] ? `[CONTEXT: ACTIVE_FILE_FOCUS]\nFILE: ${activeTab}\nCONTENT:\n${editingContents[activeTab]}\n[/CONTEXT]\n\n` : ''
    const fullMsg = contextPrefix + userMsg

    // DETECT BACKGROUND TASK DELEGATION
    if (userMsg.toLowerCase().startsWith('/task') || userMsg.toLowerCase().startsWith('!task')) {
       // Delegate to AgentDaemon!
       try {
           setIsChatStreaming(true)
           setChatMessages(prev => [...prev, { role: 'assistant', thoughts: 'Initializing background execution protocol...', content: '> DELEGATING TO AGENT_DAEMON.\n> Task ID: ' + Math.random().toString(36).substring(7).toUpperCase() }])
           await api.post('/ai/agent/task', { 
               task: userMsg.replace(/^\/(task|!task)\s*/i, ''),
               session_id: null // Or current session
           })
           // Agent will report back via database/pulse telemetry
       } catch (err) { alert('Task delegation failed') } finally { setIsChatStreaming(false) }
       return
    }

    setIsChatStreaming(true)
    try {
        const response = await fetch('/api/ai/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('hatai_token')}` },
            body: JSON.stringify({ 
                message: fullMsg, 
                model: selectedModel,
                attachments: attachments
            })
        })
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let assistantMsg = { role: 'assistant', content: '', thoughts: '' }
        setChatMessages(prev => [...prev, assistantMsg])
        
        let lastUpdateTime = Date.now()
        let isThinking = false

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            const lines = chunk.split('\n')
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6))
                        if (data.type === 'token') {
                            const token = data.content
                            
                            if (token.includes('<think>')) isThinking = true
                            if (token.includes('</think>')) { isThinking = false; assistantMsg.thoughts += token.replace('</think>', ''); continue; }

                            if (isThinking) {
                                assistantMsg.thoughts += token.replace('<think>', '')
                            } else {
                                assistantMsg.content += token
                                // AUTO-STREAM TO EDITOR
                                if (activeTab && assistantMsg.content.includes('```')) {
                                   // A simple heuristic to detect code blocks intended for the editor
                                   const lines = assistantMsg.content.split('\n')
                                   const currentBlock = lines.slice(lines.lastIndexOf(lines.find(l => l.startsWith('```'))) + 1).join('\n')
                                   if (!currentBlock.includes('```')) {
                                       setProposingContents(prev => ({ ...prev, [activeTab]: currentBlock }))
                                   }
                                }
                            }

                            const now = Date.now()
                            if (now - lastUpdateTime > 50) { // Update UI every 50ms
                                setChatMessages(prev => {
                                    const next = [...prev]
                                    next[next.length - 1] = { ...assistantMsg }
                                    return next
                                })
                                lastUpdateTime = now
                            }
                        }
                    } catch (e) {}
                }
            }
        }
        // Final update to ensure everything is rendered
        setChatMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { ...assistantMsg }
            return next
        })
    } catch (err) {} finally { setIsChatStreaming(false); }
  }

  const messagesEndRef = useRef(null)
  useEffect(() => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [chatMessages])

  const buildFileTree = (flatFiles) => {
    const root = { name: 'Root', type: 'folder', children: {}, path: '' }
    flatFiles.forEach(file => {
        const parts = file.path.split('/')
        let current = root
        parts.forEach((part, i) => {
            if (i === parts.length - 1) current.children[part] = { ...file, type: 'file' }
            else {
                if (!current.children[part]) current.children[part] = { name: part, type: 'folder', path: parts.slice(0, i + 1).join('/'), children: {} }
                current = current.children[part]
            }
        })
    })
    return root
  }

  useEffect(() => {
    const val = chatInput
    const lastAt = val.lastIndexOf('@')
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ' || val[lastAt - 1] === '\n')) {
        const query = val.substring(lastAt + 1)
        if (!query.includes(' ')) {
            setShowMentions(true)
            setMentionQuery(query)
            return
        }
    }
    setShowMentions(false)
  }, [chatInput])

  const handleMentionSelect = (file) => {
    const textBefore = chatInput.substring(0, chatInput.lastIndexOf('@'))
    const textAfter = chatInput.substring(chatInput.lastIndexOf('@') + mentionQuery.length + 1)
    setChatInput(textBefore + '@' + file.name + ' ' + textAfter)
    setShowMentions(false)
    chatInputRef.current.focus()
  }

  const filteredFiles = files.filter(f => f.path.toLowerCase().includes(searchTerm.toLowerCase()))
  const contentResults = contentSearch.length > 2 ? files.filter(f => f.content?.toLowerCase().includes(contentSearch.toLowerCase())) : []
  const fileTree = buildFileTree(filteredFiles)
  const mentionFiles = files.filter(f => f.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8)

  const renderTree = (node, depth = 0) => {
    const sorted = Object.values(node.children).sort((a,b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)))
    return sorted.map(child => (
        <div key={child.path}>
            <div onClick={() => child.type === 'folder' ? setOpenFolders(prev => { const n = new Set(prev); if (n.has(child.path)) n.delete(child.path); else n.add(child.path); return n; }) : handleOpenFile(child.path)} className={`flex items-center gap-1.5 px-3 py-0.5 cursor-pointer text-[12px] transition-colors ${activeTab === child.path ? (isDark ? 'bg-primary-500/20 text-white font-bold' : 'bg-primary-600/10 text-primary-600 font-bold') : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900')}`} style={{ paddingLeft: `${depth * 12 + 12}px` }}>
                {child.type === 'folder' ? <ChevronRight size={12} className={openFolders.has(child.path) ? 'rotate-90' : ''} /> : <span className="w-3" />}
                <span className="truncate">{child.name}</span>
            </div>
            {child.type === 'folder' && openFolders.has(child.path) && renderTree(child, depth + 1)}
        </div>
    ))
  }

  return (
    <div className={`flex h-screen overflow-hidden font-sans transition-colors duration-300 ${isDark ? 'bg-[#0a0a0c] text-white' : 'bg-light-50 text-light-900'}`}>
      
      {/* Sidebar - App Navigation */}
      <aside className={`flex flex-col bg-white dark:bg-dark-900/90 border-r border-light-200 dark:border-slate-800/60 transition-all duration-300 ease-in-out relative z-100 ${sidebarOpen ? 'w-60' : 'w-16'}`}>
        <div className="flex items-center gap-3 px-5 py-6 border-b border-light-200 dark:border-slate-800/60">
          <div className="flex-shrink-0 w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center shadow-lg"><Bot size={20} className="text-white" /></div>
          {sidebarOpen && <div className="min-w-0"><p className="font-extrabold text-base tracking-tight leading-none">HatAI</p><p className="text-[10px] font-bold text-primary-600 mt-1 uppercase tracking-widest">Remote</p></div>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="ml-auto p-1.5 text-light-400 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg">{sidebarOpen ? <X size={16}/> : <Menu size={16}/>}</button>
        </div>
        <div className="px-3 pt-3"><ModelStatusBadge isCollapsed={!sidebarOpen} /></div>
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <Link key={path} to={path} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all font-bold text-sm ${location.pathname.startsWith(path) ? 'bg-primary-600 text-white shadow-lg' : 'text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50'}`}>
              <Icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span className="truncate">{label}</span>}
            </Link>
          ))}
        </nav>
        <div className="border-t border-light-200 dark:border-slate-800/60 p-4 space-y-2">
          {sidebarOpen && user && <div className="px-3 py-1 mb-2"><p className="text-sm font-bold truncate">{user.username}</p></div>}
          <div className="space-y-1">
            <button onClick={toggleTheme} className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-bold text-light-500 hover:bg-light-100 dark:hover:bg-dark-800/50 transition-all">
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
                {sidebarOpen && <span>{isDark ? 'Chế độ sáng' : 'Chế độ tối'}</span>}
            </button>
            <button onClick={() => { logout(); navigate('/login'); }} className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-all">
                <LogOut size={18} />
                {sidebarOpen && <span>Đăng xuất</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* IDE CORE - ABSOLUTELY INDEPENDENT */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Activity Bar - NOW INSIDE THE WORKSPACE */}
        <div className={`w-14 flex flex-col items-center py-6 border-r transition-colors z-50 ${isDark ? 'bg-[#0a0a0c] border-white/5' : 'bg-white border-black/[0.05]'}`}>
            <div onClick={() => setActiveSidebarView('explorer')} className={`p-3 cursor-pointer rounded-xl mb-4 transition-all ${activeSidebarView === 'explorer' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Explorer"><FileCode size={20} /></div>
            <div onClick={() => setActiveSidebarView('search')} className={`p-3 cursor-pointer rounded-xl mb-4 transition-all ${activeSidebarView === 'search' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Search"><Search size={20} /></div>
            <div onClick={() => setActiveSidebarView('history')} className={`p-3 cursor-pointer rounded-xl mb-4 transition-all ${activeSidebarView === 'history' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Collaboration History"><History size={20} /></div>
            <div onClick={() => setActiveSidebarView('git')} className={`p-3 cursor-pointer rounded-xl transition-all ${activeSidebarView === 'git' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Source Control"><GitBranch size={20} /></div>
        </div>

        {/* Sidebar View Area */}
        <div className={`w-72 flex flex-col border-r transition-colors duration-300 ${isDark ? 'bg-[#0f0f12] border-white/5 shadow-2xl shadow-black/40' : 'bg-[#f0ede1] border-black/[0.05]'}`}>
            {activeSidebarView === 'explorer' ? (
                <>
                    <div className="p-6 pb-2 flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Explorer</span><div className="flex gap-2"><button onClick={fetchFiles} className="opacity-30 hover:opacity-100"><RotateCcw size={14}/></button></div></div>
                    <div className="px-5 py-2"><input className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-lg px-3 py-2 text-[12px] outline-none placeholder:opacity-20`} placeholder="Filter files..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                    <div className="flex-1 overflow-auto py-2 group custom-scrollbar">{renderTree(fileTree)}</div>
                </>
            ) : activeSidebarView === 'search' ? (
                <>
                    <div className="p-6 pb-2 text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Global Search</div>
                    <div className="px-5 py-2"><div className="relative"><Search className="absolute left-3 top-2.5 opacity-20" size={14} /><input className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-lg pl-10 pr-3 py-2.5 text-[12px] outline-none placeholder:opacity-40`} placeholder="Find in files..." value={contentSearch} onChange={(e) => setContentSearch(e.target.value)} /></div></div>
                    <div className="flex-1 overflow-auto py-4 px-5 space-y-4 custom-scrollbar">
                        {contentResults.length > 0 ? contentResults.map(f => (
                            <div key={f.path} onClick={() => handleOpenFile(f.path)} className={`p-4 rounded-2xl border cursor-pointer transition-all ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white/60 border-black/5 hover:bg-white'}`}><p className="text-[12px] font-black text-primary-500 mb-2 truncate">{f.name}</p><p className="text-[10px] opacity-40 mb-3 truncate">{f.path}</p><div className="text-[11px] opacity-60 font-mono line-clamp-2 italic">...{f.content?.substring(f.content.toLowerCase().indexOf(contentSearch.toLowerCase()), f.content.toLowerCase().indexOf(contentSearch.toLowerCase()) + 100)}...</div></div>
                        )) : contentSearch.length > 2 && <p className="text-center opacity-20 text-[12px] mt-10">No results found</p>}
                    </div>
                </>
            ) : activeSidebarView === 'history' ? (
                <>
                    <div className="p-6 pb-2 flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Archive</span>
                        <div className="flex gap-2">
                             <button onClick={handleNewChat} className="p-1 px-3 bg-primary-500/10 text-primary-500 rounded-full text-[8px] font-black uppercase tracking-widest hover:bg-primary-500 hover:text-white transition-all">+ New Chat</button>
                             <button onClick={fetchSessions} className="opacity-30 hover:opacity-100"><RotateCcw size={14}/></button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto py-2 px-5 space-y-3 custom-scrollbar">
                        {sessions.map(s => (
                            <div key={s.id} onClick={() => handleLoadSession(s.id)} className={`relative p-5 rounded-3xl border cursor-pointer transition-all duration-500 group/session overflow-hidden ${activeSessionId == s.id ? (isDark ? 'bg-primary-500/[0.08] border-primary-500/30 shadow-2xl shadow-primary-900/20' : 'bg-primary-500/5 border-primary-500/20 shadow-xl shadow-primary-500/10') : (isDark ? 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10' : 'bg-white/40 border-black/[0.03] hover:bg-white hover:border-black/5')}`}>
                                {activeSessionId == s.id && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-500 rounded-r-full shadow-[0_0_15px_rgba(99,102,241,0.8)]" />}
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <p className={`text-[13px] font-black leading-tight truncate group-hover/session:text-primary-500 transition-colors flex-1 ${activeSessionId == s.id ? 'text-primary-500' : (isDark ? 'text-slate-300' : 'text-slate-900')}`}>{s.title || 'Collaborative Node'}</p>
                                        <button onClick={(e) => handleDeleteSession(e, s.id)} className="opacity-0 group-hover/session:opacity-100 p-2 text-red-500/50 hover:text-red-500 transition-all hover:scale-110"><Trash2 size={12} /></button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 opacity-30 text-[9px] font-bold uppercase tracking-widest group-hover/session:opacity-60 transition-opacity">
                                            <MessageSquare size={12} /> {s.message_count || 0} Events
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-[0.1em] opacity-20 group-hover/session:opacity-40 transition-opacity">{timeAgo(s.created_at)}</span>
                                    </div>
                                </div>
                                <div className={`absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover/session:opacity-100 transition-opacity pointer-events-none`} />
                            </div>
                        ))}
                        {sessions.length === 0 && (
                            <div className="flex flex-col items-center justify-center p-12 opacity-10 space-y-4">
                                <History size={48} />
                                <p className="text-[10px] font-black uppercase tracking-[0.3em]">No Archives Found</p>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <div className="p-6 pb-2 flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Source Control</span>
                        <button onClick={fetchGitStatus} disabled={gitLoading} className="opacity-30 hover:opacity-100"><RotateCcw size={14} className={gitLoading ? 'animate-spin' : ''}/></button>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                        {!isGitInit ? (
                            <div className={`p-6 rounded-3xl border ${isDark ? 'bg-primary-500/5 border-primary-500/20' : 'bg-primary-50 border-primary-100'}`}>
                                <h3 className="text-[12px] font-black uppercase tracking-widest mb-2">Chưa kết nối Git</h3>
                                <p className="text-[10px] opacity-60 mb-6 leading-relaxed">Workspace này chưa được khởi tạo Git. Hãy kết nối để quản lý phiên bản.</p>
                                
                                <div className="space-y-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-black uppercase tracking-widest opacity-40 ml-1">GitHub Remote URL (Optional)</label>
                                        <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-xl px-4 py-2.5 text-[11px] outline-none placeholder:opacity-20`} placeholder="https://github.com/user/repo.git" />
                                    </div>
                                    <button onClick={handleGitInit} disabled={gitLoading} className="w-full py-3 bg-primary-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/30 transition-all flex items-center justify-center gap-2">
                                        {gitLoading ? <RotateCcw size={12} className="animate-spin" /> : <Plus size={14} />} 
                                        Khởi tạo & Kết nối
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className={`p-4 rounded-3xl border ${isDark ? 'bg-white/5 border-white/5' : 'bg-white/60 border-black/5 shadow-sm'}`}>
                                    <div className="flex flex-col gap-1 mb-4">
                                        <div className="flex items-center justify-between font-black text-[9px] uppercase tracking-[0.4em] mb-4">
                                            <span className="text-primary-600">Repository Status</span>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${githubUrl ? 'bg-green-500 animate-pulse ring-4 ring-green-500/20' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
                                                <span className={githubUrl ? 'text-green-500' : 'text-red-500'}>{githubUrl ? 'SYNCED' : 'DISCONNECTED'}</span>
                                            </div>
                                        </div>
                                        
                                        {/* REMOTE MANAGEMENT SECTION - IMPROVED */}
                                        <div className={`mb-6 p-5 rounded-[30px] border transition-all duration-500 ${githubUrl && !isEditingRemote ? (isDark ? 'bg-primary-500/5 border-primary-500/20' : 'bg-primary-50 border-primary-200 shadow-sm') : (isDark ? 'bg-white/5 border-white/10' : 'bg-white shadow-xl')}`}>
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2">
                                                     <Zap size={14} className={githubUrl ? 'text-primary-500' : 'text-slate-400'} />
                                                     <span className="text-[10px] font-black uppercase tracking-widest opacity-60">GitHub Remote Connection</span>
                                                </div>
                                                {githubUrl && !isEditingRemote && (
                                                    <button onClick={() => setIsEditingRemote(true)} className="text-[9px] font-black uppercase text-primary-500 hover:underline">Change</button>
                                                )}
                                            </div>

                                            {(!githubUrl || isEditingRemote) ? (
                                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                                    <div className="relative group">
                                                        <AtSign size={14} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20 group-focus-within:opacity-100 transition-opacity" />
                                                        <input 
                                                            value={githubUrl} 
                                                            onChange={(e) => setGithubUrl(e.target.value)} 
                                                            className={`w-full bg-black/10 dark:bg-white/5 border-none rounded-2xl pl-12 pr-4 py-3 text-[12px] font-mono outline-none placeholder:opacity-20 focus:ring-2 focus:ring-primary-500/50 transition-all`} 
                                                            placeholder="git@github.com:user/repo.git" 
                                                        />
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => { handleGitConnectRemote(); setIsEditingRemote(false); }} className="flex-1 py-3 bg-primary-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-lg shadow-primary-900/30 transition-all">Link & Connect</button>
                                                        {isEditingRemote && <button onClick={() => setIsEditingRemote(false)} className="px-5 py-3 border border-white/10 rounded-2xl text-[10px] font-black uppercase opacity-40 hover:opacity-100 transition-all">Cancel</button>}
                                                    </div>
                                                    <p className="text-[9px] opacity-30 text-center uppercase tracking-widest">Supports SSH (git@) and HTTPS (.git)</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-3">
                                                    <p className="text-[11px] font-mono opacity-80 break-all bg-black/10 dark:bg-white/5 p-4 rounded-2xl border border-white/5 select-all cursor-copy" onClick={() => { navigator.clipboard.writeText(githubUrl); }} title="Click to copy repo URL">
                                                        {githubUrl}
                                                    </p>
                                                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-[9px] font-black uppercase tracking-widest w-fit">
                                                        <Link2 size={10} /> Established Node
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                            <span className="text-[11px] font-black tracking-widest uppercase opacity-60">Branch: {gitStatus.branch || 'main'}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-2 opacity-30 text-[9px] font-bold">
                                            <AtSign size={10} /> {gitProfile.name || 'Author Name'}
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {GIT_PRESETS.map(p => (
                                            <button key={p.label} onClick={() => setCommitMessage(p.text)} className={`px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${isDark ? 'bg-white/5 hover:bg-white/20 text-white/40' : 'bg-black/5 hover:bg-black/10 text-black/40'}`}>
                                                {p.emoji} {p.label}
                                            </button>
                                        ))}
                                    </div>

                                    <textarea value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-xl p-3 text-[12px] outline-none placeholder:opacity-30 min-h-[80px] resize-none mb-3`} placeholder="Message (Ctrl+Enter to commit)" />
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        <button onClick={handleGitCommit} disabled={gitLoading || !commitMessage.trim()} className="py-2.5 bg-primary-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/30 disabled:opacity-30 transition-all">Commit</button>
                                        <button onClick={handleGitSync} disabled={gitLoading} className="py-2.5 bg-white/5 dark:bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 border border-white/5 transition-all flex items-center justify-center gap-2">
                                            <Zap size={10} /> Sync/Push
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[9px] font-black uppercase tracking-widest opacity-20 mb-4 px-1">Changes ({gitStatus.files.length})</p>
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                        {gitStatus.files.map(f => (
                                            <div key={f.file} onClick={() => handleOpenFile(f.file)} className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${isDark ? 'bg-white/[0.02] border-white/5 hover:bg-white/5' : 'bg-white/40 border-black/[0.02] hover:bg-white shadow-sm'}`}>
                                                <div className="flex items-center gap-3 truncate">
                                                    <FileCode size={14} className="opacity-30 group-hover:text-primary-500 transition-colors" />
                                                    <span className="text-[12px] font-bold truncate opacity-80 group-hover:opacity-100">{f.file.split('/').pop()}</span>
                                                </div>
                                                <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black ${f.status === 'M' ? 'text-yellow-500 bg-yellow-500/10' : (f.status === 'A' || f.status === '??' ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10')}`}>{f.status === '??' ? 'U' : f.status}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
                                    <div className="flex items-center justify-between px-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest opacity-30">Git Cheat Sheet</p>
                                        <button onClick={() => setShowCheatSheet(!showCheatSheet)} className={`text-[10px] font-black uppercase tracking-widest hover:text-primary-500 transition-all ${showCheatSheet ? 'text-primary-500' : 'opacity-40 hover:opacity-100'}`}>{showCheatSheet ? 'Hide' : 'Show'}</button>
                                    </div>
                                    
                                    {showCheatSheet && (
                                        <div className="grid grid-cols-1 gap-2 animate-in fade-in slide-in-from-top-2 duration-500">
                                            {[
                                                { cmd: 'git status', desc: 'Kiểm tra thay đổi' },
                                                { cmd: 'git pull origin main', desc: 'Cập nhật từ GitHub' },
                                                { cmd: 'git push origin main', desc: 'Đẩy lên GitHub' },
                                                { cmd: 'git log --oneline', desc: 'Lịch sử rút gọn' },
                                                { cmd: 'git checkout -b dev', desc: 'Tạo nhánh nháp' },
                                                { cmd: 'git reset --hard HEAD', desc: 'Về lại lúc nãy' }
                                            ].map(item => (
                                                <div key={item.cmd} onClick={() => { navigator.clipboard.writeText(item.cmd); }} className={`flex flex-col p-3 rounded-2xl border cursor-pointer transition-all ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-black/5 hover:shadow-md'}`}>
                                                    <code className="text-[11px] font-bold text-primary-500">{item.cmd}</code>
                                                    <span className="text-[9px] opacity-40 mt-1 uppercase tracking-widest">{item.desc}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </>
            )}
        </div>

        <div className={`flex-1 flex flex-col relative overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0a0a0c]' : 'bg-white'}`}>
            <div className={`flex items-center border-b transition-colors duration-300 ${isDark ? 'bg-[#0f0f12] border-white/5' : 'bg-[#f0ede1] border-black/[0.05]'}`}>
                <div className="flex-1 flex overflow-x-auto custom-scrollbar-h min-h-[44px]">
                    {openTabs.map(path => (
                        <div key={path} onClick={() => setActiveTab(path)} className={`px-5 py-3 border-r cursor-pointer text-[11px] font-bold whitespace-nowrap transition-all group flex items-center gap-3 ${isDark ? (activeTab === path ? 'bg-[#0a0a0c] text-primary-400 border-b-2 border-primary-500' : 'opacity-40 border-white/5 hover:opacity-100') : (activeTab === path ? 'bg-white text-primary-600' : 'opacity-30 border-black/[0.05] hover:opacity-100')}`}>
                            {path.split('/').pop()}{pendingChanges[path] && <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />}<X size={12} className="opacity-0 group-hover:opacity-40 hover:!opacity-100" onClick={(e) => { e.stopPropagation(); setOpenTabs(prev => prev.filter(p => p !== path)); if (activeTab === path) setActiveTab(openTabs.filter(p => p !== path)[0] || null); }} />
                        </div>
                    ))}
                </div>
                {activeTab && (
                    <div className="flex items-center gap-2 px-4 border-l border-white/5">
                        <button onClick={() => handleSaveFile(activeTab)} disabled={saving[activeTab]} className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${pendingChanges[activeTab] ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'opacity-40 hover:opacity-100'}`}>
                            {saving[activeTab] ? <RotateCcw size={10} className="animate-spin" /> : <Save size={10} />}
                            {saving[activeTab] ? 'Syncing...' : (pendingChanges[activeTab] ? 'Save & Push' : 'Saved')}
                        </button>
                        <button onClick={handleGitSync} className="p-2 opacity-30 hover:opacity-100 hover:text-primary-500 transition-all" title="Force Sync All"><Zap size={14}/></button>
                    </div>
                )}
            </div>
            <div className="flex-1 flex flex-col relative overflow-hidden">
                {activeTab ? (
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <div className="flex min-h-full relative">
                            {/* AI RECONSTRUCTION OVERLAY - NEW */}
                            {proposingContents[activeTab] && (
                                <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden flex">
                                    <div className="w-[60px]" /> {/* Spacer for line numbers */}
                                    <div className="flex-1 p-10 pl-4 bg-primary-500/5 backdrop-blur-[1px] animate-pulse-slow">
                                        <div className="flex items-center gap-2 mb-4 text-[10px] font-black text-primary-500 uppercase tracking-widest opacity-60">
                                            <Sparkles size={12}/> AI RECONSTRUCTION IN PROGRESS...
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* LINE NUMBERS */}
                            <div className={`p-10 pr-4 text-right font-mono text-[14px] select-none opacity-20 border-r ${isDark ? 'border-white/5' : 'border-black/5'}`} style={{ minWidth: '60px', userSelect: 'none', backgroundColor: 'transparent' }}>
                                {(proposingContents[activeTab] || editingContents[activeTab] || '').split('\n').map((_, i) => (
                                    <div key={i} style={{ height: '1.8em', lineHeight: '1.8em' }}>{i + 1}</div>
                                ))}
                            </div>
                            
                            <div className="flex-1 p-10 pl-4">
                                <Editor 
                                    value={proposingContents[activeTab] || editingContents[activeTab] || ''} 
                                    onValueChange={code => { setEditingContents(prev => ({ ...prev, [activeTab]: code })); if (code !== originalContents[activeTab]) setPendingChanges(p => ({ ...p, [activeTab]: true })); }} 
                                    highlight={code => highlight(code, (activeTab.endsWith('.py') ? languages.python : (activeTab.endsWith('.css') ? languages.css : (activeTab.endsWith('.html') ? languages.markup : languages.javascript))), activeTab.split('.').pop())} 
                                    padding={0} 
                                    style={{ fontFamily: '"Fira Code", "Fira Mono", monospace', fontSize: 14, minHeight: '100%', outline: 'none', caretColor: isDark ? '#fff' : '#000', color: isDark ? (proposingContents[activeTab] ? '#00ff99' : '#d4d4d4') : (proposingContents[activeTab] ? '#006644' : '#2d2d2d'), lineHeight: '1.8em', transition: 'color 0.3s ease' }} 
                                />
                                {proposingContents[activeTab] && !isChatStreaming && (
                                    <div className="mt-8 flex gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
                                        <button onClick={() => { setEditingContents(prev => ({ ...prev, [activeTab]: proposingContents[activeTab] })); setProposingContents(prev => ({ ...prev, [activeTab]: null })); setPendingChanges(prev => ({ ...prev, [activeTab]: true })); }} className="px-6 py-2 bg-primary-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/30">Accept Reconstruction</button>
                                        <button onClick={() => setProposingContents(prev => ({ ...prev, [activeTab]: null }))} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/5`}>Discard</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-8 opacity-05"><Brain size={160} className="text-primary-500" /><span className="text-[12px] font-black uppercase tracking-[2em]">Core Stable</span></div>
                )}
                {/* TELEMETRY FEED - REFINED */}
                <div className={`h-48 border-t p-6 overflow-auto font-mono text-[11px] space-y-2 custom-scrollbar transition-all duration-700 ${isDark ? 'bg-[#08080a] border-white/5 text-slate-500 shadow-[inset_0_20px_40px_rgba(0,0,0,0.5)]' : 'bg-[#f5f2e8] border-black/5 text-slate-400 shadow-inner'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3 font-black uppercase tracking-[0.4em] opacity-40 text-primary-500">
                             <Activity size={14} className="animate-pulse" /> 
                             Pulse Diagnostics
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-green-500/10 text-green-500 border border-green-500/20 animate-pulse">● LIVE_NODE</span>
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">DB_LINK_ACTIVE</span>
                        </div>
                    </div>
                    {systemLogs.map((log, i) => (
                        <div key={i} className={`flex gap-4 group/log py-0.5 border-l-2 pl-3 transition-all ${log.startsWith('[THOUGHT]') ? 'border-primary-500/40 text-primary-500/70' : 'border-transparent hover:border-slate-800'}`}>
                            <span className="opacity-20 shrink-0 select-none">[{new Date().toLocaleTimeString()}]</span>
                            <span className="truncate group-hover/log:whitespace-normal group-hover/log:break-all">{log}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Chat Sidebar */}
        <div className={`w-[450px] border-l flex flex-col relative transition-all duration-300 ${showChat ? 'translate-x-0' : 'translate-x-full fixed right-[-450px]'} ${isDark ? 'bg-[#0a0a0c] border-white/5 shadow-2xl shadow-black/80' : 'bg-[#f5f2eb] border-black/[0.05]'}`}>
            {!showChat && <button onClick={() => setShowChat(true)} className={`absolute left-[-40px] top-1/2 -translate-y-1/2 w-10 h-20 border rounded-l-2xl flex items-center justify-center shadow-2xl hover:scale-105 transition-all ${isDark ? 'bg-[#111114] border-white/10 text-primary-400' : 'bg-[#f5f2eb] border-black/5'}`}><Sparkles size={24} /></button>}
            <div className={`p-8 flex items-center justify-between`}>
                <div className="flex items-center gap-4"><div className="w-10 h-10 bg-primary-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-primary-600/30"><Zap size={20} /></div><h2 className="text-[14px] font-black uppercase tracking-[0.4em]">HatAI Code</h2></div>
                <button onClick={() => setShowChat(false)} className={`p-2 rounded-xl transition-all ${isDark ? 'hover:bg-white/5 text-slate-500 hover:text-white' : 'hover:bg-black/5 text-slate-300 hover:text-black'}`}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-auto px-8 py-4 space-y-12 custom-scrollbar">
                {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex flex-col gap-6 w-full animate-slide-up mb-8 last:mb-12 ${msg.role === 'user' ? 'items-end' : 'items-start'}`} style={{ animationDelay: `${i * 100}ms` }}>
                        
                        {/* Role Header */}
                        <div className="flex items-center gap-3 px-1">
                            {msg.role === 'user' ? (
                                <>
                                    <span className="text-[9px] font-black uppercase tracking-[0.3em] opacity-40">Command Node</span>
                                    <div className="w-6 h-[1px] bg-primary-500/30" />
                                </>
                            ) : (
                                <>
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-pulse ring-4 ring-primary-600/20" />
                                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-primary-600">Core Engine</span>
                                </>
                            )}
                        </div>

                        {msg.role === 'user' ? (
                            <div className="flex flex-col items-end gap-5 max-w-[90%]">
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-4 justify-end">
                                        {msg.attachments.map((file, idx) => (
                                            <div key={idx} className={`relative group max-w-[220px] rounded-2xl overflow-hidden shadow-2xl transition-all duration-500 hover:scale-[1.05] hover:rotate-1 ${isDark ? 'ring-1 ring-white/10' : 'ring-1 ring-black/5'}`}>
                                                {file.type?.startsWith('image') ? (
                                                    <img src={file.url} className="w-full object-cover aspect-square bg-[#0c0c0e]" alt="Context" />
                                                ) : (
                                                    <div className="p-8 flex flex-col items-center justify-center gap-3 bg-[#0c0c0e]/40 backdrop-blur-md"><FileCode size={32} className="text-primary-500" /><span className="text-[10px] font-black opacity-30 tracking-[0.2em]">{file.name?.split('.').pop().toUpperCase()}</span></div>
                                                )}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className={`px-8 py-6 text-[15px] leading-relaxed font-bold border ${isDark ? 'bg-[#121217] border-white/5 text-slate-100 rounded-[35px] rounded-tr-none shadow-2xl shadow-black/80' : 'bg-white border-black/[0.03] text-slate-800 rounded-[35px] rounded-tr-none shadow-xl shadow-black/5'}`}>
                                    {msg.content}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-8 w-full max-w-full pl-2">
                                {msg.thoughts && (
                                    <div className={`relative p-5 rounded-3xl border transition-all duration-700 group/logic ${isDark ? 'bg-primary-500/[0.02] border-primary-500/10 hover:border-primary-500/30' : 'bg-primary-50/20 border-primary-100/50 hover:border-primary-200'}`}>
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-[0.2em] text-primary-500/60">
                                                <div className="w-2 h-2 rounded-full bg-primary-600/40 animate-ping" />
                                                Logic Stream
                                            </div>
                                            <div className="flex-1 h-[1px] bg-primary-500/10" />
                                            <div className="text-[8px] font-mono opacity-20 group-hover/logic:opacity-60 transition-opacity">DIAGNOSTIC_LOG_V2.0</div>
                                        </div>
                                        <div className={`text-[13px] leading-relaxed font-medium italic font-mono space-y-2 transition-colors ${isDark ? 'text-slate-400 group-hover/logic:text-slate-300' : 'text-slate-500 group-hover/logic:text-slate-800'}`}>
                                            {msg.thoughts.replace(/<\/?think>/gi,'').split('\n').map((line, idx) => (
                                                <p key={idx} className="relative pl-5 before:content-['>'] before:absolute before:left-0 before:opacity-30 before:text-[10px]">{line}</p>
                                            ))}
                                        </div>
                                        <div className={`absolute -inset-[1px] rounded-3xl bg-gradient-to-br transition-opacity duration-700 pointer-events-none opacity-0 group-hover/logic:opacity-100 ${isDark ? 'from-primary-500/10 via-transparent to-transparent' : 'from-primary-500/5 via-transparent to-transparent'}`} />
                                    </div>
                                )}
                                <div className={`prose prose-sm max-w-none prose-p:leading-[1.9] prose-p:text-[15px] prose-p:font-semibold prose-strong:text-primary-600 transition-colors ${isDark ? 'prose-invert text-slate-200' : 'text-slate-800'}`}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                                        code({node, inline, className, children, ...props}) {
                                            const match = /language-(\w+)/.exec(className || '')
                                            return !inline && match ? (
                                                <SyntaxHighlighter style={isDark ? vscDarkPlus : oneLight} language={match[1]} PreTag="div" {...props}>
                                                    {String(children).replace(/\n$/, '')}
                                                </SyntaxHighlighter>
                                            ) : (
                                                <code className={className} {...props}>{children}</code>
                                            )
                                        }
                                    }}>{msg.content}</ReactMarkdown>
                                </div>
                                {msg.meta && msg.meta.type === 'edit' && (
                                    <div className={`p-8 rounded-[40px] border shadow-2xl space-y-5 group/proposal overflow-hidden relative ${isDark ? 'bg-[#0f0f12] border-white/10 shadow-black' : 'bg-white border-black/[0.05] shadow-black/5'}`}>
                                        <div className="flex items-center justify-between font-black text-[9px] uppercase tracking-[0.4em] text-primary-600 opacity-60">
                                            <span>IDE Reconstruction Protocol</span>
                                            <div className="flex items-center gap-1.5"><Activity size={10} className="animate-pulse" /> Live</div>
                                        </div>
                                        <div className="flex items-center gap-4 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-white/5">
                                            <FileCode size={24} className="text-primary-500" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] font-black truncate">{msg.meta.files[0]}</p>
                                                <p className="text-[9px] font-mono opacity-20 uppercase tracking-widest mt-1">Pending approval</p>
                                            </div>
                                        </div>
                                        <button onClick={() => msg.meta.files.forEach(f => handleSaveFile(f))} className="w-full h-14 bg-primary-600 hover:bg-primary-500 text-white rounded-[22px] text-[12px] font-black uppercase tracking-[0.3em] shadow-2xl shadow-primary-900/40 hover:shadow-primary-500/40 active:scale-[0.98] transition-all flex items-center justify-center gap-4 group">
                                            Apply Protocol <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                                        </button>
                                        <div className="absolute top-0 right-0 w-24 h-24 bg-primary-600/10 blur-[60px] pointer-events-none" />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} className="h-4" />
            </div>
            <div className="p-8 pb-12 pt-4 relative">
                {showMentions && mentionFiles.length > 0 && (
                    <div className={`absolute bottom-full left-8 right-8 mb-4 rounded-2xl border shadow-3xl z-[800] overflow-hidden ${isDark ? 'bg-[#1a1a1f] border-white/10 shadow-black' : 'bg-white border-black/10'}`}>
                        <div className="px-4 py-2 text-[10px] font-black opacity-30 border-b border-white/5 uppercase tracking-widest">Suggest Files</div>
                        {mentionFiles.map(f => (
                           <button key={f.path} onClick={() => handleMentionSelect(f)} className={`w-full flex items-center gap-3 px-4 py-3 text-[12px] text-left transition-all ${isDark ? 'hover:bg-primary-600 text-slate-300 hover:text-white' : 'hover:bg-primary-50 text-slate-600 hover:text-primary-700'}`}><FileCode size={14} className="opacity-40" /><span className="font-bold">{f.name}</span><span className="opacity-30 text-[10px] truncate">{f.path}</span></button>
                        ))}
                    </div>
                )}
                {/* CONTEXT LOCK INDICATOR - ENHANCED */}
                {activeTab && (
                    <div className="flex px-6 mb-2">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest animate-pulse-slow ${editingContents[activeTab] ? (isDark ? 'bg-primary-500/10 border-primary-500/20 text-primary-500' : 'bg-primary-100/50 border-primary-200 text-primary-700') : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500'}`}>
                            <Link2 size={10} /> {editingContents[activeTab] ? 'Focus Ready' : 'Syncing Context'}: {activeTab.split('/').pop()}
                        </div>
                    </div>
                )}

                <div className={`border rounded-[40px] p-3 flex flex-col gap-2 transition-all ${isDark ? 'bg-[#111114] border-white/10 focus-within:border-primary-500/50 shadow-inner' : 'bg-[#ede8d8]/60 border-black/10 focus-within:border-black/20 shadow-sm'}`}>
                    
                    {/* ATTACHMENT PREVIEW - NEW */}
                    {attachments.length > 0 && (
                        <div className="flex gap-4 px-6 pt-4 overflow-x-auto custom-scrollbar-h pb-2">
                             {attachments.map((file, idx) => (
                                 <div key={idx} className="relative group shrink-0">
                                     <div className={`w-20 h-20 rounded-2xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                                         {file.type?.startsWith('image') ? <img src={file.url} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40"><FileCode size={20}/><span className="text-[8px] uppercase font-black">File</span></div>}
                                     </div>
                                     <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 opacity-0 group-hover:opacity-100 transition-all"><X size={12} /></button>
                                 </div>
                             ))}
                        </div>
                    )}

                    <textarea 
                        ref={chatInputRef} 
                        className={`w-full bg-transparent px-6 py-5 text-[15px] outline-none min-h-[140px] max-h-[400px] resize-none font-bold transition-all ${isDark ? 'placeholder:opacity-20 text-white' : 'placeholder:opacity-50 text-slate-900'}`} 
                        placeholder="Sync thoughts..." 
                        value={chatInput} 
                        onChange={(e) => setChatInput(e.target.value)} 
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }} 
                    />
                    <div className="flex items-center justify-between px-5 pb-3">
                        <div className="flex gap-2 relative">
                            <input type="file" id="media-upload" className="hidden" onChange={handleFileUpload} accept="image/*,application/pdf" />
                            <button onClick={(e) => { e.stopPropagation(); setIsContextOpen(!isContextOpen); }} className={`w-10 h-10 flex items-center justify-center rounded-full border shadow-sm transition-all duration-300 active:scale-90 ${isContextOpen ? 'bg-primary-600 border-primary-500 text-white shadow-lg' : (isDark ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-white/80 border-black/5 text-slate-500 shadow-sm')}`}>{isUploadingMedia ? <Activity size={18} className="animate-spin" /> : <Plus size={18} className={`transition-transform duration-300 ${isContextOpen ? 'rotate-45' : ''}`} />}</button>
                            {isContextOpen && (
                                <div className={`absolute bottom-[calc(100%+12px)] left-0 w-60 p-2 rounded-2xl border shadow-3xl z-[900] animate-slide-up backdrop-blur-3xl ${isDark ? 'bg-[#1a1a1f]/98 border-white/10 shadow-black' : 'bg-[#f0ede1]/95 border-black/10'}`}>
                                    <div className={`px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] opacity-40 border-b mb-1 ${isDark ? 'border-white/5' : 'border-black/[0.05]'}`}>Context Hub</div>
                                    <div className="space-y-1">
                                        {[
                                            { id: 'media', label: 'Media', icon: ImageIcon, color: 'text-orange-500', action: () => document.getElementById('media-upload').click() },
                                            { id: 'mentions', label: 'Mentions', icon: AtSign, color: 'text-indigo-500', action: () => { setChatInput(p => p + '@'); setIsContextOpen(false); chatInputRef.current.focus(); } },
                                            { id: 'workflows', label: 'Workflows', icon: SquareSlash, color: 'text-primary-500', action: () => { setChatInput(p => p + '/'); setIsContextOpen(false); chatInputRef.current.focus(); } }
                                        ].map(item => (
                                            <button key={item.id} onClick={(e) => { e.stopPropagation(); item.action(); }} className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${isDark ? 'hover:bg-white/5 text-slate-300 hover:text-white' : 'hover:bg-black/5 text-slate-700 hover:text-black font-bold'}`}><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5' : 'bg-black/5'}`}><item.icon size={18} className={item.color} /></div><span className="text-[13px]">{item.label}</span></button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <button onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)} className={`px-6 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${isDark ? 'bg-white/5 border-white/10 text-primary-400 hover:border-primary-500/30' : 'bg-white/80 border-black/5 text-slate-500 shadow-sm'}`}>{selectedModel}</button>
                        </div>
                        <button onClick={handleSendChat} disabled={!chatInput.trim() || isChatStreaming} className={`w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${isChatStreaming ? 'bg-primary-500/20 text-primary-500 animate-pulse' : (isDark ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-900/40' : 'bg-white hover:bg-primary-600 text-slate-600 hover:text-white')}`}>{isChatStreaming ? <Bot size={22} className="animate-bounce" /> : <ArrowRight size={24} />}</button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  )
}
