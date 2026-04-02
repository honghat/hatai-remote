import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import {
  Clock, Plus, Trash2, X, Play, Pause, Power, Edit3,
  CheckCircle2, AlertCircle, RefreshCw, Calendar, Zap, ToggleLeft, ToggleRight
} from 'lucide-react'

const CRON_PRESETS = [
  { label: 'Mỗi 30 phút', value: '*/30 * * * *' },
  { label: 'Mỗi giờ', value: '0 * * * *' },
  { label: 'Mỗi 3 giờ', value: '0 */3 * * *' },
  { label: 'Mỗi 6 giờ', value: '0 */6 * * *' },
  { label: 'Mỗi ngày 8h sáng', value: '0 8 * * *' },
  { label: 'Mỗi ngày 8h & 18h', value: '0 8,18 * * *' },
  { label: 'Thứ 2-6, 9h sáng', value: '0 9 * * 1-5' },
  { label: 'Mỗi tuần (CN 0h)', value: '0 0 * * 0' },
  { label: 'Mỗi tháng (ngày 1)', value: '0 0 1 * *' },
]

function formatCron(expr) {
  const preset = CRON_PRESETS.find(p => p.value === expr)
  if (preset) return preset.label
  return expr
}

function formatDate(d) {
  if (!d) return '--'
  return new Date(d).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-xs text-slate-500">--</span>
  const cfg = {
    done: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'OK' },
    error: { color: 'text-red-500', bg: 'bg-red-500/10', label: 'Lỗi' },
    cancelled: { color: 'text-slate-500', bg: 'bg-slate-500/10', label: 'Huỷ' },
    running: { color: 'text-primary-500', bg: 'bg-primary-500/10', label: 'Đang chạy' },
  }
  const c = cfg[status] || cfg.error
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.bg} ${c.color} uppercase`}>
      {c.label}
    </span>
  )
}

export default function Schedules() {
  const [schedules, setSchedules] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  // Form state
  const [formName, setFormName] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formCron, setFormCron] = useState('0 * * * *')
  const [formCustomCron, setFormCustomCron] = useState('')
  const [useCustomCron, setUseCustomCron] = useState(false)

  const fetchSchedules = useCallback(async () => {
    try {
      const { data } = await api.get('/schedules')
      setSchedules(data)
    } catch (err) {
      console.error('Failed to fetch schedules:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSchedules()
    const interval = setInterval(fetchSchedules, 30000)
    return () => clearInterval(interval)
  }, [fetchSchedules])

  const openCreateModal = () => {
    setEditingSchedule(null)
    setFormName('')
    setFormPrompt('')
    setFormCron('0 * * * *')
    setFormCustomCron('')
    setUseCustomCron(false)
    setIsModalOpen(true)
  }

  const openEditModal = (sched) => {
    setEditingSchedule(sched)
    setFormName(sched.name)
    setFormPrompt(sched.prompt)
    const isPreset = CRON_PRESETS.some(p => p.value === sched.cron_expression)
    if (isPreset) {
      setFormCron(sched.cron_expression)
      setUseCustomCron(false)
      setFormCustomCron('')
    } else {
      setFormCron('')
      setUseCustomCron(true)
      setFormCustomCron(sched.cron_expression)
    }
    setIsModalOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formName.trim() || !formPrompt.trim()) return

    const cronExpr = useCustomCron ? formCustomCron.trim() : formCron
    if (!cronExpr) return

    setIsSubmitting(true)
    try {
      if (editingSchedule) {
        const { data } = await api.put(`/schedules/${editingSchedule.id}`, {
          name: formName,
          prompt: formPrompt,
          cron_expression: cronExpr,
        })
        setSchedules(prev => prev.map(s => s.id === data.id ? data : s))
      } else {
        const { data } = await api.post('/schedules', {
          name: formName,
          prompt: formPrompt,
          cron_expression: cronExpr,
        })
        setSchedules(prev => [data, ...prev])
      }
      setIsModalOpen(false)
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggle = async (id) => {
    try {
      const { data } = await api.post(`/schedules/${id}/toggle`)
      setSchedules(prev => prev.map(s => s.id === data.id ? data : s))
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleTrigger = async (id) => {
    try {
      const { data } = await api.post(`/schedules/${id}/trigger`)
      setSchedules(prev => prev.map(s => s.id === data.id ? data : s))
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Bạn có chắc muốn xoá tác vụ định kỳ này?')) return
    try {
      await api.delete(`/schedules/${id}`)
      setSchedules(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-600 dark:bg-primary-600/20 border border-primary-500/20 rounded-xl flex items-center justify-center shadow-lg shadow-primary-600/10">
              <Clock size={20} className="text-white dark:text-primary-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-light-900 dark:text-white">Tác vụ Định kỳ</h1>
              <p className="text-xs text-light-500 dark:text-slate-500">Task định kỳ chạy tự động theo lịch</p>
            </div>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-primary-500/20"
          >
            <Plus size={16} /> Tạo mới
          </button>
        </div>

        {/* Schedule List */}
        {loading ? (
          <div className="text-center py-12 text-slate-500">
            <RefreshCw size={24} className="animate-spin mx-auto mb-3" />
            Đang tải...
          </div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-dark-900 rounded-2xl border border-light-200 dark:border-slate-800">
            <Calendar size={48} className="mx-auto mb-4 text-light-300 dark:text-slate-700" />
            <p className="text-light-500 dark:text-slate-500 text-sm mb-4">Chưa có task định kỳ nào</p>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-all"
            >
              <Plus size={16} /> Tạo task định kỳ đầu tiên
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map(sched => (
              <div
                key={sched.id}
                className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl p-4 hover:border-primary-300 dark:hover:border-primary-700/50 transition-all group"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-light-900 dark:text-white truncate">{sched.name}</h3>
                      {sched.is_enabled ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">ON</span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 border border-slate-500/20">OFF</span>
                      )}
                    </div>

                    <p className="text-sm text-light-600 dark:text-slate-400 line-clamp-2 mb-2">{sched.prompt}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-light-500 dark:text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {formatCron(sched.cron_expression)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar size={12} /> Tiếp: {formatDate(sched.next_run_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        Lần cuối: {formatDate(sched.last_run_at)}
                      </span>
                      <StatusBadge status={sched.last_status} />
                      <span className="text-primary-500 font-bold">#{sched.run_count} lần</span>
                    </div>

                    {sched.last_result && (
                      <div className="mt-2 text-xs text-light-600 dark:text-slate-400 bg-light-50 dark:bg-dark-950 rounded-lg p-2 line-clamp-2 border border-light-200 dark:border-slate-800">
                        {sched.last_result}
                      </div>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleToggle(sched.id)}
                      className={`p-2 rounded-lg transition-all ${
                        sched.is_enabled
                          ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/10'
                          : 'text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800'
                      }`}
                      title={sched.is_enabled ? 'Tắt' : 'Bật'}
                    >
                      {sched.is_enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                    <button
                      onClick={() => handleTrigger(sched.id)}
                      className="p-2 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/10 rounded-lg transition-all"
                      title="Chạy ngay"
                    >
                      <Zap size={18} />
                    </button>
                    <button
                      onClick={() => openEditModal(sched)}
                      className="p-2 text-light-400 dark:text-slate-500 hover:text-primary-500 hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      title="Chỉnh sửa"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(sched.id)}
                      className="p-2 text-light-400 dark:text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      title="Xoá"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !isSubmitting && setIsModalOpen(false)} />
          <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative animate-fade-in">
            <div className="p-5 border-b border-light-200 dark:border-slate-800/60 flex justify-between items-center">
              <h3 className="font-bold text-lg text-light-900 dark:text-white flex items-center gap-2">
                <Clock size={18} className="text-primary-500" />
                {editingSchedule ? 'Chỉnh sửa Tác vụ Định kỳ' : 'Tạo Tác vụ Định kỳ'}
              </h3>
              <button
                onClick={() => !isSubmitting && setIsModalOpen(false)}
                className="p-1.5 text-light-400 hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg"
                disabled={isSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs font-bold text-light-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Tên task</label>
                <input
                  autoFocus
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="VD: Cập nhật tin tức hàng ngày"
                  className="w-full px-3 py-2 bg-light-50 dark:bg-dark-950 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-light-900 dark:text-white text-sm"
                  disabled={isSubmitting}
                />
              </div>

              {/* Prompt */}
              <div>
                <label className="text-xs font-bold text-light-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Lệnh cho Agent</label>
                <textarea
                  value={formPrompt}
                  onChange={e => setFormPrompt(e.target.value)}
                  placeholder="VD: Tìm 5 tin tức công nghệ mới nhất, tóm tắt và lưu vào knowledge"
                  className="w-full h-24 px-3 py-2 bg-light-50 dark:bg-dark-950 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none text-light-900 dark:text-white text-sm"
                  disabled={isSubmitting}
                />
              </div>

              {/* Cron */}
              <div>
                <label className="text-xs font-bold text-light-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Lịch chạy</label>
                {!useCustomCron ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      {CRON_PRESETS.map(preset => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setFormCron(preset.value)}
                          className={`text-xs px-2 py-1.5 rounded-lg border transition-all font-medium ${
                            formCron === preset.value
                              ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                              : 'border-light-200 dark:border-slate-800 text-light-600 dark:text-slate-400 hover:border-primary-300'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setUseCustomCron(true)}
                      className="text-xs text-primary-500 hover:underline"
                    >
                      Nhập cron tuỳ chỉnh...
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={formCustomCron}
                      onChange={e => setFormCustomCron(e.target.value)}
                      placeholder="*/30 * * * * (phút giờ ngày tháng thứ)"
                      className="w-full px-3 py-2 bg-light-50 dark:bg-dark-950 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-light-900 dark:text-white text-sm font-mono"
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => { setUseCustomCron(false); setFormCron('0 * * * *') }}
                      className="text-xs text-primary-500 hover:underline"
                    >
                      Chọn từ preset...
                    </button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-light-600 dark:text-slate-300 hover:bg-light-100 dark:hover:bg-dark-800 transition-all"
                  disabled={isSubmitting}
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={!formName.trim() || !formPrompt.trim() || isSubmitting || (!useCustomCron && !formCron) || (useCustomCron && !formCustomCron.trim())}
                  className="px-6 py-2 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <><RefreshCw size={16} className="animate-spin" /> Đang lưu...</>
                  ) : (
                    <><CheckCircle2 size={16} /> {editingSchedule ? 'Cập nhật' : 'Tạo'}</>
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
