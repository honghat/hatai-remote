import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import useDaemonSocket from '../hooks/useDaemonSocket'
import {
  ListTodo, Plus, Trash2, X, Activity, CheckCircle2,
  AlertCircle, Search, RefreshCw, XCircle, ChevronRight, Play, RotateCcw
} from 'lucide-react'

export default function Tasks() {
  const [tasks, setTasks] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const [logs, setLogs] = useState([])
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newTaskPrompt, setNewTaskPrompt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const logsEndRef = useRef(null)
  const selectedTaskRef = useRef(null)

  // Socket
  const daemon = useDaemonSocket()

  // Polling states
  const listPollerRef = useRef(null)
  const logsPollerRef = useRef(null)
  const lastLogIndexRef = useRef(0)

  // Initial load
  useEffect(() => {
    fetchTasks()
    
    // Cleanup pollers on unmount
    return () => {
      clearInterval(listPollerRef.current)
      clearInterval(logsPollerRef.current)
    }
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current && logs.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // Setup list poller if there are running tasks
  useEffect(() => {
    const hasRunning = tasks.some(t => ['pending', 'running'].includes(t.status))
    
    clearInterval(listPollerRef.current)
    if (hasRunning) {
      // Use slower polling if daemon is connected (3s -> 5s)
      listPollerRef.current = setInterval(fetchTasks, daemon.connected ? 5000 : 3000)
    }
  }, [tasks, daemon.connected])

  // Sync ref
  useEffect(() => { selectedTaskRef.current = selectedTask }, [selectedTask])

  // Setup logs poller when task selected
  useEffect(() => {
    clearInterval(logsPollerRef.current)
    setLogs([])
    lastLogIndexRef.current = 0
    
    if (selectedTask) {
      fetchLogs(selectedTask.id)
      
      // Still poll logs but less frequently if daemon is connected
      if (['pending', 'running'].includes(selectedTask.status)) {
        logsPollerRef.current = setInterval(() => {
          fetchLogs(selectedTask.id)
        }, daemon.connected ? 4000 : 2000)
      }
    }
  }, [selectedTask, daemon.connected])

  // Handle Real-time socket events
  useEffect(() => {
    daemon.onEvent((event) => {
      // Real-time LOGS
      if (event.type === 'task_log') {
        const curId = selectedTaskRef.current?.id
        const log = event.log
        if (event.task_id === curId && log.index >= lastLogIndexRef.current) {
          setLogs(prev => [...prev, log])
          lastLogIndexRef.current = log.index + 1
        }
        
        // Also update progress in the list if we have it
        if (log.type === 'tool_call') {
           setTasks(prev => prev.map(t => {
             if (t.id === event.task_id) {
               return { ...t, status: 'running', progress: Math.min(95, (t.progress || 0) + 5) }
             }
             return t
           }))
        }
        return
      }

      // Real-time STATUS/RESULT
      if (event.type === 'task_result') {
        setTasks(prev => prev.map(t => {
           if (t.id === event.task_id) {
             return { ...t, status: 'done', progress: 100, result: event.result }
           }
           return t
        }))
        
        // Update selected task if it matches
        if (selectedTaskRef.current?.id === event.task_id) {
           setSelectedTask(prev => ({ ...prev, status: 'done', progress: 100, result: event.result }))
        }
      }
    })
  }, [daemon])

  const fetchTasks = async () => {
    try {
      const { data } = await api.get('/tasks')
      setTasks(data)

      const cur = selectedTaskRef.current
      if (cur) {
        const updated = data.find(t => t.id === cur.id)
        if (updated && updated.status !== cur.status) {
          setSelectedTask(updated)
        }
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
    }
  }

  const fetchLogs = async (taskId) => {
    try {
      const { data } = await api.get(`/tasks/${taskId}/logs?since=${lastLogIndexRef.current}`)
      if (data?.length > 0) {
        setLogs(prev => [...prev, ...data.filter(log => log.index >= lastLogIndexRef.current)])
        lastLogIndexRef.current = data[data.length - 1].index + 1
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    }
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    if (!newTaskPrompt.trim()) return
    
    setIsSubmitting(true)
    try {
      const { data } = await api.post('/tasks', { prompt: newTaskPrompt })
      setNewTaskPrompt('')
      setIsModalOpen(false)
      setTasks(prev => [data, ...prev])
      setSelectedTask(data)
    } catch (err) {
      alert('Không thể tạo task mới: ' + (err.response?.data?.detail || err.message))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelTask = async (id, e) => {
    e.stopPropagation()
    try {
      await api.post(`/tasks/${id}/cancel`)
      fetchTasks()
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDeleteTask = async (id, e) => {
    e.stopPropagation()
    try {
      await api.delete(`/tasks/${id}`)
      setTasks(prev => prev.filter(t => t.id !== id))
      if (selectedTask?.id === id) setSelectedTask(null)
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleRerunTask = async (id, e) => {
    e.stopPropagation()
    try {
      const { data } = await api.post(`/tasks/${id}/rerun`)
      setTasks(prev => [data, ...prev])
      setSelectedTask(data)
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDeleteAllTasks = async () => {
    if (tasks.length === 0) return
    
    try {
      await api.delete('/tasks')
      setTasks([])
      setSelectedTask(null)
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const getStatusConfig = (status, progress) => {
    const configs = {
      pending: { icon: RefreshCw, color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Chờ xử lý', anim: 'animate-spin' },
      running: { icon: Activity, color: 'text-primary-500', bg: 'bg-primary-500/10', border: 'border-primary-500/20', label: `Đang chạy (${progress || 0}%)`, anim: 'animate-pulse' },
      done: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Hoàn thành' },
      error: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Lỗi' },
      cancelled: { icon: XCircle, color: 'text-slate-500', bg: 'bg-light-100 dark:bg-slate-800', border: 'border-light-200 dark:border-slate-700', label: 'Đã huỷ' },
    }
    return configs[status] || configs.pending
  }

  return (
    <div className="flex h-full w-full bg-light-50 dark:bg-dark-950 overflow-hidden relative">
      
      {/* Sidebar Task List */}
      <div className="w-80 h-full flex flex-col border-r border-light-200 dark:border-slate-800/60 bg-white dark:bg-dark-900 z-10">
        <div className="p-4 border-b border-light-200 dark:border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-light-900 dark:text-white font-bold">
            <ListTodo size={18} className="text-primary-500" />
            <span>Agent Tasks</span>
          </div>
          <div className="flex gap-2">
            {tasks.length > 0 && (
              <button
                onClick={handleDeleteAllTasks}
                className="p-1.5 text-light-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-all"
                title="Xoá tất cả"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              onClick={() => setIsModalOpen(true)}
              className="p-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-all shadow-md shadow-primary-500/20"
              title="Thêm task mới"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {tasks.length === 0 ? (
            <div className="text-center p-6 text-sm text-light-500 dark:text-slate-500">
              <ListTodo size={32} className="mx-auto mb-3 opacity-20" />
              Chưa có task nào chạy ngầm. Bấm + để tạo.
            </div>
          ) : (
            tasks.map(task => {
              const statusCfg = getStatusConfig(task.status, task.progress)
              const StatusIcon = statusCfg.icon
              const isSelected = selectedTask?.id === task.id
              
              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className={`relative overflow-hidden group p-3 border rounded-xl cursor-pointer transition-all duration-200 
                    ${isSelected 
                      ? 'border-primary-500/50 bg-primary-50 dark:bg-primary-900/10 shadow-sm' 
                      : 'border-light-200 dark:border-slate-800 hover:border-primary-300 dark:hover:border-primary-700/50 bg-white dark:bg-dark-800/50'}`}
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary-400 to-primary-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  {isSelected && <div className="absolute top-0 left-0 w-1 h-full bg-primary-500" />}
                  
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className={`text-xs font-bold px-2 py-0.5 rounded-full border flex items-center gap-1.5 w-fit ${statusCfg.bg} ${statusCfg.border} ${statusCfg.color}`}>
                      <StatusIcon size={12} className={statusCfg.anim} />
                      {statusCfg.label}
                    </div>
                    
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {['pending', 'running'].includes(task.status) ? (
                        <button onClick={(e) => handleCancelTask(task.id, e)} className="p-1 text-slate-400 hover:text-amber-500 bg-white dark:bg-dark-900 rounded-md" title="Huỷ">
                          <XCircle size={14} />
                        </button>
                      ) : (
                        <>
                          <button onClick={(e) => handleRerunTask(task.id, e)} className="p-1 text-slate-400 hover:text-primary-500 bg-white dark:bg-dark-900 rounded-md" title="Chạy lại">
                            <RotateCcw size={14} />
                          </button>
                          <button onClick={(e) => handleDeleteTask(task.id, e)} className="p-1 text-slate-400 hover:text-red-500 bg-white dark:bg-dark-900 rounded-md" title="Xoá">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <p className="text-sm font-medium text-light-900 dark:text-white line-clamp-2 leading-snug">
                    {task.prompt}
                  </p>
                  <div className="flex justify-between items-center mt-2">
                    <p className="text-[10px] text-light-500 dark:text-slate-500">
                      {new Date(task.created_at).toLocaleString('vi-VN')}
                    </p>
                    <span className="text-[10px] font-bold text-primary-500 bg-primary-50 dark:bg-primary-900/20 px-1.5 py-0.5 rounded border border-primary-500/20 uppercase">
                      {task.model_name || 'agent'}
                    </span>
                  </div>

                  {/* Tiny progress bar */}
                  {['pending', 'running'].includes(task.status) && (
                    <div className="absolute bottom-0 left-0 h-0.5 bg-primary-500 transition-all duration-500" style={{ width: `${task.progress || 0}%` }} />
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Main Task View */}
      <div className="flex-1 flex flex-col h-full bg-light-50/50 dark:bg-dark-950/50">
        {!selectedTask ? (
          <div className="flex-1 flex flex-col items-center justify-center text-light-500 dark:text-slate-500">
            <Activity size={48} className="mb-4 opacity-10" />
            <p className="text-sm font-medium">Chọn một task bên trái để xem tiến độ</p>
          </div>
        ) : (
          <>
            {(() => {
              const sc = getStatusConfig(selectedTask.status, selectedTask.progress)
              return (
                <div className="p-5 border-b border-light-200 dark:border-slate-800/60 bg-white dark:bg-dark-900 flex justify-between items-start glass-pane">
                  <div>
                    <h2 className="text-lg font-bold text-light-900 dark:text-white mb-2 leading-tight pr-8">
                      {selectedTask.prompt}
                    </h2>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-light-500 dark:text-slate-400">ID: {selectedTask.id}</span>
                      <span className="w-1 h-1 rounded-full bg-light-300 dark:bg-slate-700" />
                      <span className="text-light-500 dark:text-slate-400">
                        Bắt đầu: {new Date(selectedTask.created_at).toLocaleTimeString('vi-VN')}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-light-300 dark:bg-slate-700" />
                      <span className="text-primary-500 font-bold uppercase text-[10px] tracking-wider bg-primary-50 dark:bg-primary-900/10 px-2 py-0.5 rounded border border-primary-500/20">
                        {selectedTask.model_name || 'agent'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {!['pending', 'running'].includes(selectedTask.status) && (
                      <button
                        onClick={(e) => handleRerunTask(selectedTask.id, e)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary-500/20 bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 text-sm font-bold transition-all"
                      >
                        <RotateCcw size={14} /> Chạy lại
                      </button>
                    )}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${sc.bg} ${sc.border} ${sc.color}`}>
                      <Activity size={16} className={sc.anim} />
                      <span className="text-sm font-bold">{sc.label}</span>
                    </div>
                  </div>
                </div>
              )
            })()}

            <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm relative">
              {logs.length === 0 && !selectedTask.result ? (
                <div className="text-center pt-10 text-slate-500 animate-pulse flex items-center justify-center gap-2">
                  <RefreshCw size={16} className="animate-spin" /> Retrieving logs...
                </div>
              ) : (
                <>
                  {logs.map((log) => (
                    <div key={log.index} className="flex gap-3 text-light-700 dark:text-slate-300 animate-fade-in group">
                      <div className="w-16 flex-shrink-0 text-xs text-light-400 dark:text-slate-600 self-start pt-1">
                        {new Date(log.timestamp * 1000).toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                      </div>
                      
                      <div className="flex-1 space-y-1">
                        {log.type === 'tool_call' && (
                          <div className="text-primary-600 dark:text-primary-400 font-semibold bg-primary-50 dark:bg-primary-900/10 px-2 py-1 rounded inline-block">
                            {log.content} <span className="text-light-400 dark:text-slate-500 ml-1 text-xs">{JSON.stringify(log.args)}</span>
                          </div>
                        )}
                        {log.type === 'tool_result' && log.result && (
                          <div className="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/10 px-2 py-1.5 rounded text-xs whitespace-pre-wrap max-h-[300px] overflow-y-auto custom-scrollbar border border-emerald-500/10">
                            {JSON.stringify(log.result, null, 2)}
                          </div>
                        )}
                        {log.type === 'screenshot' && (
                          <div className="mt-2 border-2 border-primary-500/20 rounded-xl overflow-hidden inline-block max-w-sm">
                            <img src={log.content.startsWith('/') ? `${api.defaults.baseURL}${log.content}` : log.content} alt="Screenshot" className="w-full h-auto" />
                          </div>
                        )}
                        {log.type === 'text' && (
                          <div className="text-light-900 dark:text-slate-200 whitespace-pre-wrap leading-relaxed px-2">
                            {log.content}
                          </div>
                        )}
                        {log.type === 'thinking' && (
                          <div className="text-amber-600 dark:text-amber-500/80 italic border-l-2 border-amber-500/50 pl-3 ml-2 text-xs">
                            {log.content}
                          </div>
                        )}
                        {(log.type === 'error' || log.type === 'cancelled') && (
                          <div className="text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-900/10 px-2 py-1 rounded border border-red-500/10">
                            {log.content}
                          </div>
                        )}
                        {log.type === 'done' && (
                          <div className="text-emerald-600 dark:text-emerald-400 font-bold mt-4 flex items-center gap-2">
                            <CheckCircle2 size={16} /> Task Completed.
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Final Result fallback if logs were missing */}
                  {selectedTask.result && logs.length === 0 && (
                    <div className="text-light-900 dark:text-slate-200 whitespace-pre-wrap leading-relaxed p-4 bg-white dark:bg-dark-900 rounded-xl border border-light-200 dark:border-dark-800 shadow-sm">
                      <div className="text-xs font-bold uppercase text-primary-500 mb-2 tracking-wider flex items-center gap-2">
                        <CheckCircle2 size={14} /> Result Summary
                      </div>
                      {selectedTask.result}
                    </div>
                  )}
                  
                  {/* Keep scrolling to bottom */}
                  <div ref={logsEndRef} className="h-4" />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create Task Modal */}
      {isModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !isSubmitting && setIsModalOpen(false)} />
          <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative animate-fade-in">
            <div className="p-5 border-b border-light-200 dark:border-slate-800/60 flex justify-between items-center bg-light-50/50 dark:bg-dark-900/50">
              <h3 className="font-bold text-lg text-light-900 dark:text-white flex items-center gap-2">
                <Play size={18} className="text-primary-500" fill="currentColor" />
                Chạy Task Mới
              </h3>
              <button 
                onClick={() => !isSubmitting && setIsModalOpen(false)}
                className="p-1.5 text-light-400 disabled:opacity-50 hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg"
                disabled={isSubmitting}
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleCreateTask} className="p-5">
              <p className="text-sm text-light-500 dark:text-slate-400 mb-4 leading-relaxed">
                Agent sẽ chạy ngầm và tự động thực hiện các thao tác (kể cả điều khiển web) liên tục cho đến khi hoàn thành để đạt được mục tiêu của bạn.
              </p>
              <textarea
                autoFocus
                value={newTaskPrompt}
                onChange={(e) => setNewTaskPrompt(e.target.value)}
                placeholder="Ví dụ: Lên VnExpress đọc 3 bài báo mới nhất, tóm tắt và lưu vào file tin_tuc.txt"
                className="w-full h-32 p-3 bg-light-50 dark:bg-dark-950 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none text-light-900 dark:text-white mb-5 transition-all"
                disabled={isSubmitting}
              />
              
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-light-600 dark:text-slate-300 hover:bg-light-100 dark:hover:bg-dark-800 transition-all disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={!newTaskPrompt.trim() || isSubmitting}
                  className="px-6 py-2 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <><RefreshCw size={16} className="animate-spin" /> Đang khởi động...</>
                  ) : (
                    <><ListTodo size={16} /> Bắt đầu chạy</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
