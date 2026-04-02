import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import { Terminal as TerminalIcon } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import {
  Monitor, Plus, Trash2, X, Wifi, WifiOff, Settings, Play,
  RefreshCw, Server, Edit3, CheckCircle2, Unplug, Plug
} from 'lucide-react'

export default function TerminalPage() {
  const [connections, setConnections] = useState([])
  const [activeConn, setActiveConn] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState('')

  // Form (Connections)
  const [formName, setFormName] = useState('')
  const [formHost, setFormHost] = useState('')
  const [formPort, setFormPort] = useState(22)
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formAuthMethod, setFormAuthMethod] = useState('password')
  const [formPrivateKey, setFormPrivateKey] = useState('')
  const [formDefaultDir, setFormDefaultDir] = useState('')

  // Commands state
  const [commands, setCommands] = useState([])
  const [isCmdModalOpen, setIsCmdModalOpen] = useState(false)
  const [editingCmd, setEditingCmd] = useState(null)
  const [formCmdName, setFormCmdName] = useState('')
  const [formCmdContent, setFormCmdContent] = useState('')
  const [formCmdCategory, setFormCmdCategory] = useState('general')

  // Terminal refs
  const termRef = useRef(null)
  const termContainerRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)

  // Fetch connections and commands
  const fetchConnections = useCallback(async () => {
    try {
      const { data } = await api.get('/ssh/connections')
      setConnections(data)
    } catch (err) {
      console.error('Failed to fetch SSH connections:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCommands = useCallback(async () => {
    try {
      const { data } = await api.get('/ssh/commands')
      setCommands(data)
    } catch (err) {
      console.error('Failed to fetch SSH commands:', err)
    }
  }, [])

  useEffect(() => {
    fetchConnections()
    fetchCommands()
    return () => disconnectSSH()
  }, [])

  // Resize observer
  useEffect(() => {
    if (!termContainerRef.current || !fitAddonRef.current) return
    const obs = new ResizeObserver(() => {
      try { fitAddonRef.current?.fit() } catch {}
    })
    obs.observe(termContainerRef.current)
    return () => obs.disconnect()
  }, [isConnected])

  // ── SSH Connect ──
  const connectSSH = async (conn) => {
    disconnectSSH()
    setActiveConn(conn)
    setIsConnecting(true)
    setStatusMsg('Đang kết nối...')

    // Init xterm
    const term = new TerminalIcon({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        cursorAccent: '#0a0a0f',
        selectionBackground: '#6366f150',
        black: '#1e293b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    termRef.current = term
    fitAddonRef.current = fitAddon

    if (termContainerRef.current) {
      termContainerRef.current.innerHTML = ''
      term.open(termContainerRef.current)
      setTimeout(() => fitAddon.fit(), 100)
    }

    term.writeln('\x1b[1;36m  Đang kết nối tới ' + conn.host + '...\x1b[0m\r\n')

    // WebSocket
    const token = localStorage.getItem('hatai_token')
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.hostname}:8000/ssh/ws/${conn.id}?token=${token}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'connected') {
          setIsConnected(true)
          setIsConnecting(false)
          setStatusMsg(msg.host)
          term.writeln('\x1b[1;32m  Kết nối thành công!\x1b[0m\r\n')
          setTimeout(() => fitAddon.fit(), 200)
        } else if (msg.type === 'output') {
          term.write(msg.data)
        } else if (msg.type === 'error') {
          term.writeln('\r\n\x1b[1;31m  Lỗi: ' + msg.message + '\x1b[0m\r\n')
          setIsConnecting(false)
          setStatusMsg('Lỗi kết nối')
        }
      } catch {}
    }

    ws.onclose = () => {
      setIsConnected(false)
      setIsConnecting(false)
      if (termRef.current) {
        termRef.current.writeln('\r\n\x1b[1;33m  Phiên SSH đã đóng.\x1b[0m')
      }
      setStatusMsg('Đã ngắt kết nối')
    }

    // Terminal input → SSH
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Terminal resize → SSH
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    term.focus()
  }

  const disconnectSSH = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }
    fitAddonRef.current = null
    setIsConnected(false)
    setIsConnecting(false)
  }

  // ── Connection CRUD ──
  const openCreateModal = () => {
    setEditingConn(null)
    setFormName(''); setFormHost(''); setFormPort(22)
    setFormUsername('root'); setFormPassword(''); setFormAuthMethod('password')
    setFormPrivateKey(''); setFormDefaultDir('')
    setIsModalOpen(true)
  }

  const openEditModal = (conn) => {
    setEditingConn(conn)
    setFormName(conn.name); setFormHost(conn.host); setFormPort(conn.port)
    setFormUsername(conn.username); setFormPassword(''); setFormAuthMethod(conn.auth_method)
    setFormPrivateKey(''); setFormDefaultDir(conn.default_directory || '')
    setIsModalOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formName.trim() || !formHost.trim() || !formUsername.trim()) return
    setIsSubmitting(true)
    try {
      const payload = {
        name: formName, host: formHost, port: formPort,
        username: formUsername, auth_method: formAuthMethod,
        default_directory: formDefaultDir || null,
      }
      if (formAuthMethod === 'password' && formPassword) payload.password = formPassword
      if (formAuthMethod === 'key' && formPrivateKey) payload.private_key = formPrivateKey

      if (editingConn) {
        const { data } = await api.put(`/ssh/connections/${editingConn.id}`, payload)
        setConnections(prev => prev.map(c => c.id === data.id ? data : c))
      } else {
        const { data } = await api.post('/ssh/connections', payload)
        setConnections(prev => [data, ...prev])
      }
      setIsModalOpen(false)
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Xoá kết nối này?')) return
    try {
      await api.delete(`/ssh/connections/${id}`)
      setConnections(prev => prev.filter(c => c.id !== id))
      if (activeConn?.id === id) disconnectSSH()
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  // ── Command CRUD ──
  const openCmdModal = (cmd = null) => {
    if (cmd) {
      setEditingCmd(cmd)
      setFormCmdName(cmd.name)
      setFormCmdContent(cmd.command)
      setFormCmdCategory(cmd.category || 'general')
    } else {
      setEditingCmd(null)
      setFormCmdName('')
      setFormCmdContent('')
      setFormCmdCategory('general')
    }
    setIsCmdModalOpen(true)
  }

  const handleCmdSubmit = async (e) => {
    e.preventDefault()
    if (!formCmdName.trim() || !formCmdContent.trim()) return
    setIsSubmitting(true)
    try {
      const payload = {
        name: formCmdName,
        command: formCmdContent,
        category: formCmdCategory
      }
      if (editingCmd) {
        const { data } = await api.put(`/ssh/commands/${editingCmd.id}`, payload)
        setCommands(prev => prev.map(c => c.id === data.id ? data : c))
      } else {
        const { data } = await api.post('/ssh/commands', payload)
        setCommands(prev => [data, ...prev])
      }
      setIsCmdModalOpen(false)
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteCommand = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Xoá lệnh này?')) return
    try {
      await api.delete(`/ssh/commands/${id}`)
      setCommands(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const runCommand = (cmdText) => {
    if (!isConnected || !wsRef.current) {
        alert("Vui lòng kết nối server để chạy lệnh.")
        return
    }
    const text = cmdText.endsWith('\n') ? cmdText : cmdText + '\n'
    wsRef.current.send(JSON.stringify({ type: 'input', data: text }))
    termRef.current?.focus()
  }

  return (
    <div className="flex h-full w-full bg-light-50 dark:bg-dark-950 overflow-hidden">
      {/* Sidebar: Connections */}
      <div className="w-64 h-full flex flex-col border-r border-light-200 dark:border-slate-800/60 bg-white dark:bg-dark-900 shadow-xl z-20">
        <div className="p-4 border-b border-light-200 dark:border-slate-800/60 flex items-center justify-between bg-white dark:bg-dark-900">
          <div className="flex items-center gap-2 text-light-900 dark:text-white font-bold">
            <Server size={18} className="text-primary-500" />
            <span className="truncate">Kết nối SSH</span>
          </div>
          <button
            onClick={openCreateModal}
            className="p-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-all shadow-md shadow-primary-500/20"
            title="Thêm kết nối"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center p-6 text-sm text-slate-500">
              <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
              Đang tải...
            </div>
          ) : connections.length === 0 ? (
            <div className="text-center p-6 text-sm text-light-500 dark:text-slate-500 mt-10">
              <Server size={32} className="mx-auto mb-3 opacity-20" />
              Chưa có kết nối nào.
            </div>
          ) : (
            connections.map(conn => {
              const isActive = activeConn?.id === conn.id
              return (
                <div
                  key={conn.id}
                  onClick={() => !isConnecting && connectSSH(conn)}
                  className={`group p-3 border rounded-xl cursor-pointer transition-all duration-200
                    ${isActive && isConnected
                      ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-900/10 shadow-sm'
                      : isActive
                        ? 'border-primary-500/50 bg-primary-50 dark:bg-primary-900/10'
                        : 'border-light-200 dark:border-slate-800 hover:border-primary-300 dark:hover:border-primary-700/50 bg-white dark:bg-dark-800/50'}`}
                >
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <div className="flex items-center gap-2 overflow-hidden">
                      {isActive && isConnected ? (
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                      )}
                      <span className="font-bold text-sm text-light-900 dark:text-white truncate">{conn.name}</span>
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); openEditModal(conn) }} className="p-1 text-slate-400 hover:text-primary-500 rounded" title="Sửa">
                        <Edit3 size={11} />
                      </button>
                      <button onClick={(e) => handleDelete(conn.id, e)} className="p-1 text-slate-400 hover:text-red-500 rounded" title="Xoá">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-light-500 dark:text-slate-500 font-mono truncate">
                    {conn.host}
                  </p>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Main Area: Terminal + Commands */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Terminal Header */}
        <div className="px-4 py-2.5 border-b border-light-200 dark:border-slate-800/60 bg-white dark:bg-dark-900 flex items-center justify-between z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <Monitor size={18} className={isConnected ? 'text-emerald-500' : 'text-slate-400'} />
            <span className="font-extrabold text-sm text-light-900 dark:text-white uppercase tracking-tight">
              {activeConn ? activeConn.name : 'Web Terminal'}
            </span>
            {statusMsg && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter ${
                isConnected ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
              }`}>
                {statusMsg}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {isConnected && (
              <button
                onClick={disconnectSSH}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 border border-red-500/20 transition-all"
              >
                <Unplug size={14} /> Ngắt kết nối
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Terminal Container */}
          <div className="flex-1 relative bg-[#0a0a0f] p-1.5">
            {!activeConn && !isConnecting ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-light-50 dark:bg-dark-950/20">
                <Monitor size={64} className="mb-4 opacity-5" />
                <p className="text-sm font-bold uppercase tracking-widest opacity-30">Sẵn sàng kết nối</p>
                <p className="text-xs opacity-20 mt-2">Chọn server từ danh sách bên trái</p>
              </div>
            ) : (
              <div ref={termContainerRef} className="h-full w-full rounded-md overflow-hidden" />
            )}
          </div>

          {/* Right Sidebar: Command Library */}
          <div className="w-80 h-full border-l border-light-200 dark:border-slate-800/60 bg-white dark:bg-dark-950 flex flex-col z-20">
            <div className="p-4 border-b border-light-200 dark:border-slate-800/60 flex items-center justify-between bg-light-50 dark:bg-dark-900/50">
                <div className="flex items-center gap-2">
                    <Settings size={18} className="text-amber-500" />
                    <span className="font-extrabold text-sm uppercase tracking-wider dark:text-white">Lệnh lưu sẵn</span>
                </div>
                <button
                    onClick={() => openCmdModal()}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-all"
                >
                    <Plus size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
                {commands.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 opacity-20">
                        <Play size={48} className="mb-2" />
                        <span className="text-xs font-bold text-center uppercase tracking-tighter">Chưa có lệnh lưu sẵn</span>
                    </div>
                ) : (
                    // Group by category
                    Object.entries(
                        commands.reduce((acc, c) => {
                            const cat = c.category || 'Chung'
                            if (!acc[cat]) acc[cat] = []
                            acc[cat].push(c)
                            return acc
                        }, {})
                    ).map(([cat, cmds]) => (
                        <div key={cat} className="space-y-2">
                            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">{cat}</h4>
                            <div className="grid gap-2">
                                {cmds.map(cmd => (
                                    <div 
                                        key={cmd.id}
                                        className="group relative bg-light-100 dark:bg-slate-900/40 border border-light-200 dark:border-slate-800/50 rounded-xl p-3 hover:border-primary-500/50 hover:bg-white dark:hover:bg-slate-800 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                                        onClick={() => runCommand(cmd.command)}
                                    >
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <span className="text-xs font-bold dark:text-slate-200 leading-tight group-hover:text-primary-500 transition-colors">{cmd.name}</span>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={(e) => { e.stopPropagation(); openCmdModal(cmd) }} className="p-1 text-slate-500 hover:text-amber-500"><Edit3 size={12} /></button>
                                                <button onClick={(e) => deleteCommand(cmd.id, e)} className="p-1 text-slate-500 hover:text-red-500"><Trash2 size={12} /></button>
                                            </div>
                                        </div>
                                        <code className="block text-[10px] text-slate-500 font-mono truncate bg-light-200 dark:bg-black/20 px-1.5 py-0.5 rounded border border-light-300 dark:border-white/5">
                                            {cmd.command}
                                        </code>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Connection Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-md" onClick={() => !isSubmitting && setIsModalOpen(false)} />
          <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl relative animate-in fade-in zoom-in duration-200 overflow-hidden">
            <div className="p-6 border-b border-light-200 dark:border-slate-800/60 flex justify-between items-center bg-light-50/50 dark:bg-dark-900/50">
              <h3 className="font-extrabold text-xl text-light-900 dark:text-white flex items-center gap-3">
                <div className="p-2 rounded-2xl bg-primary-500/20 text-primary-500"><Server size={20} /></div>
                <span>{editingConn ? 'Cập nhật Server' : 'Thêm Server'}</span>
              </h3>
              <button onClick={() => !isSubmitting && setIsModalOpen(false)} className="p-2 text-light-400 hover:bg-light-100 dark:hover:bg-dark-800 rounded-2xl transition-colors">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
               <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block pl-1">Tên Hiển Thị</label>
                    <input autoFocus value={formName} onChange={e => setFormName(e.target.value)}
                      placeholder="VD: Production" 
                      className="w-full px-4 py-3 bg-light-50 dark:bg-black/20 border border-light-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-light-900 dark:text-white text-sm font-bold" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-[10px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block pl-1">Host / IP</label>
                    <input value={formHost} onChange={e => setFormHost(e.target.value)}
                      placeholder="127.0.0.1" 
                      className="w-full px-4 py-3 bg-light-50 dark:bg-black/20 border border-light-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-light-900 dark:text-white text-sm font-mono" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-[10px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block pl-1">Port</label>
                    <input type="number" value={formPort} onChange={e => setFormPort(parseInt(e.target.value) || 22)}
                      className="w-full px-4 py-3 bg-light-50 dark:bg-black/20 border border-light-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-light-900 dark:text-white text-sm font-mono" />
                  </div>
               </div>

              <div className="p-4 bg-light-100/50 dark:bg-black/20 rounded-3xl space-y-4 border border-light-200/50 dark:border-white/5">
                <div className="flex gap-2">
                    {['password', 'key'].map(m => (
                        <button key={m} type="button" onClick={() => setFormAuthMethod(m)}
                            className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            formAuthMethod === m
                                ? 'bg-white dark:bg-slate-800 text-primary-500 shadow-md'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            {m === 'password' ? 'Mật khẩu' : 'SSH Key'}
                        </button>
                    ))}
                </div>

                <div>
                    <label className="text-[10px] font-black text-light-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block pl-1">User & Credentials</label>
                    <div className="grid gap-3">
                        <input value={formUsername} onChange={e => setFormUsername(e.target.value)}
                            placeholder="username" 
                            className="w-full px-4 py-2.5 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-500/50 text-sm font-bold" />
                        
                        {formAuthMethod === 'password' ? (
                            <input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)}
                                placeholder="••••••••" 
                                className="w-full px-4 py-2.5 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-500/50 text-sm" />
                        ) : (
                            <textarea value={formPrivateKey} onChange={e => setFormPrivateKey(e.target.value)}
                                placeholder="-----BEGIN RSA PRIVATE KEY-----" rows={3}
                                className="w-full px-4 py-3 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-500/50 text-[10px] font-mono resize-none shadow-inner" />
                        )}
                    </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800 transition-all">
                  Huỷ
                </button>
                <button type="submit"
                  disabled={!formName.trim() || !formHost.trim() || !formUsername.trim() || isSubmitting}
                  className="px-8 py-3 rounded-2xl text-sm font-black uppercase tracking-widest text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-xl shadow-primary-600/30 active:scale-95 disabled:opacity-50">
                  {isSubmitting ? 'Đang lưu...' : (editingConn ? 'Cập nhật' : 'Khởi tạo')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Command Library Modal */}
      {isCmdModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-md" onClick={() => !isSubmitting && setIsCmdModalOpen(false)} />
            <div className="bg-white dark:bg-dark-900 border border-border rounded-3xl w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in duration-200 overflow-hidden">
                <div className="p-6 border-b border-light-200 dark:border-slate-800/60 flex justify-between items-center bg-light-50/50 dark:bg-dark-900/50">
                    <h3 className="font-extrabold text-xl text-light-900 dark:text-white flex items-center gap-3">
                        <div className="p-2 rounded-2xl bg-amber-500/20 text-amber-500"><Plus size={20} /></div>
                        <span>{editingCmd ? 'Sửa lệnh' : 'Lưu lệnh mới'}</span>
                    </h3>
                    <button onClick={() => setIsCmdModalOpen(false)} className="p-2 text-slate-400 hover:bg-dark-800 rounded-2xl transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleCmdSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Tên lệnh gợi nhớ</label>
                        <input autoFocus value={formCmdName} onChange={e => setFormCmdName(e.target.value)}
                            placeholder="VD: Check Logs" 
                            className="w-full px-4 py-3 bg-light-50 dark:bg-black/20 border border-light-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-sm font-bold" />
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Dòng lệnh thực thi</label>
                        <textarea value={formCmdContent} onChange={e => setFormCmdContent(e.target.value)}
                            placeholder="tail -f /var/log/syslog" rows={4}
                            className="w-full px-4 py-3 bg-light-50 dark:bg-black/20 border border-light-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-xs font-mono resize-none shadow-inner" />
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Phân loại</label>
                        <select value={formCmdCategory} onChange={e => setFormCmdCategory(e.target.value)}
                            className="w-full px-4 py-3 bg-light-50 dark:bg-black/20 border border-light-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-sm">
                            <option value="general">Mặc định / Chung</option>
                            <option value="logs">Nhật ký (Logs)</option>
                            <option value="docker">Docker</option>
                            <option value="git">Git / Deployment</option>
                            <option value="sys">Hệ thống (Stats)</option>
                        </select>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <button type="button" onClick={() => setIsCmdModalOpen(false)}
                            className="px-6 py-3 text-sm font-black uppercase text-slate-500 hover:text-slate-300 transition-all">Huỷ</button>
                        <button type="submit" disabled={isSubmitting}
                            className="px-8 py-3 rounded-2xl text-sm font-black uppercase tracking-widest text-white bg-amber-600 hover:bg-amber-500 transition-all shadow-xl shadow-amber-600/30 active:scale-95 disabled:grayscale">
                            {isSubmitting ? 'Đang lưu...' : 'Lưu lại'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  )
}
