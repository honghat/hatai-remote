import { useState, useEffect } from 'react'
import api from '../../api'
import { 
  Activity, Search, Filter, RefreshCw, 
  User, Calendar, Clock, Globe, Info, Zap, Trash2
} from 'lucide-react'
import Card from '../../components/Card'

export default function ActivityLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [userIdFilter, setUserIdFilter] = useState('')
  const [users, setUsers] = useState([])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const resp = await api.get('/admin/activities', {
        params: {
          limit: 100,
          user_id: userIdFilter || undefined
        }
      })
      setLogs(resp.data)
    } catch (err) {
      console.error('Failed to fetch logs', err)
    } finally {
      setLoading(false)
    }
  }

  const handleClearAll = async () => {
    // No confirm() as per user request
    setClearing(true)
    try {
      await api.delete('/admin/activities/clear')
      setLogs([])
    } catch (err) {
      alert('Không thể xóa lịch sử: ' + (err.response?.data?.detail || err.message))
    } finally {
      setClearing(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const resp = await api.get('/admin/users')
      setUsers(resp.data)
    } catch (err) {}
  }

  useEffect(() => {
    fetchLogs()
    fetchUsers()
  }, [userIdFilter])

  const filteredLogs = logs.filter(log => 
    (log.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.details || '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getMethodColor = (method) => {
    switch (method) {
      case 'POST': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
      case 'PUT': return 'text-amber-500 bg-amber-500/10 border-amber-500/20'
      case 'DELETE': return 'text-red-500 bg-red-500/10 border-red-500/20'
      default: return 'text-primary-500 bg-primary-500/10 border-primary-500/20'
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-primary-500/10 rounded-xl shadow-lg shadow-primary-500/5">
              <Activity size={24} className="text-primary-500" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">Lịch sử hoạt động</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleClearAll} 
              disabled={clearing || logs.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-red-500 hover:text-white hover:bg-red-500 border border-red-500/20 hover:border-red-500 rounded-xl transition-all text-xs font-black uppercase tracking-widest disabled:opacity-30 disabled:pointer-events-none"
            >
              <Trash2 size={16} />
              {clearing ? 'Đang xóa...' : 'Xóa tất cả'}
            </button>
            <button onClick={fetchLogs} className="p-2.5 text-light-500 hover:text-primary-500 transition-all border border-light-200 dark:border-slate-800 rounded-xl">
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="p-6 bg-light-50/50 dark:bg-transparent space-y-4 border-b border-light-200 dark:border-slate-800/40">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-light-400" size={18} />
            <input 
              type="text" 
              placeholder="Tìm kiếm hành động, người dùng..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
             <Filter size={18} className="text-light-400" />
             <select 
               value={userIdFilter}
               onChange={e => setUserIdFilter(e.target.value)}
               className="px-4 py-2.5 bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 rounded-xl focus:outline-none text-sm font-medium"
             >
               <option value="">Tất cả người dùng</option>
               {users.map(u => (
                 <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
               ))}
             </select>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-light-50/50 dark:bg-dark-800/50 border-b border-light-200 dark:border-slate-800/60">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500">Timestamp</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500">Hành động</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500">Method/Path</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500">Người thực hiện</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-100 dark:divide-slate-800/40">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan="5" className="px-6 py-10">
                        <div className="h-4 bg-light-200 dark:bg-dark-800 rounded w-full"></div>
                      </td>
                    </tr>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-20 text-center text-light-400 dark:text-slate-600 font-bold uppercase tracking-widest opacity-30 text-xs">
                      Không tìm thấy dữ liệu hoạt động
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-light-50/50 dark:hover:bg-dark-800/30 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-light-900 dark:text-white">
                            {new Date(log.timestamp).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] text-light-400 dark:text-slate-500 flex items-center gap-1">
                            <Clock size={10} /> {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                           <div className="p-1.5 rounded-lg bg-primary-500/10 text-primary-500"><Zap size={14} /></div>
                           <span className="text-sm font-bold text-light-800 dark:text-slate-200">{log.action || 'Unknown Action'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border w-fit ${getMethodColor(log.method)}`}>
                            {log.method}
                          </div>
                          <span className="text-xs font-mono text-light-400 dark:text-slate-500 truncate max-w-[200px]">{log.path}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-light-200 dark:bg-dark-800 flex items-center justify-center text-xs font-black text-light-600 dark:text-slate-400 uppercase">
                            {(log.username || '?')[0]}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-light-900 dark:text-white">{log.username || 'System'}</span>
                            <span className="text-[10px] text-light-400 dark:text-slate-500">ID: {log.user_id || 'N/A'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-mono text-light-400 dark:text-slate-500">{log.ip_address || '--'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
