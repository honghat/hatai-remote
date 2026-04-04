import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  Users, Plus, Search, Edit3, Trash2, Shield, ShieldCheck, ShieldOff,
  UserCheck, UserX, X, Save, Eye, EyeOff, Lock, Download
} from 'lucide-react'


function UserFormModal({ user, roles, onClose, onSaved }) {
  const isEdit = !!user
  const [form, setForm] = useState({
    username: user?.username || '',
    full_name: user?.full_name || '',
    email: user?.email || '',
    role_id: user?.role_id || '',
    is_active: user?.is_active ?? true,
    password: '',
  })
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, role_id: form.role_id ? Number(form.role_id) : null }
      if (isEdit) {
        if (!payload.password) delete payload.password
        delete payload.username
        await api.put(`/admin/users/${user.id}`, payload)
      } else {
        if (!payload.password) { setError('Mật khẩu là bắt buộc'); setSaving(false); return }
        await api.post('/admin/users', payload)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi lưu user')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-dark-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 border border-light-200 dark:border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-100 dark:border-slate-800 bg-light-50/50 dark:bg-dark-800/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
              {isEdit ? <Edit3 size={16} className="text-white" /> : <Plus size={16} className="text-white" />}
            </div>
            <h3 className="text-base font-extrabold text-light-900 dark:text-white">
              {isEdit ? 'Chỉnh sửa Người dùng' : 'Tạo Người dùng Mới'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-light-100 dark:hover:bg-dark-800 text-light-400 dark:text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!isEdit && (
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Username</label>
              <input
                type="text" required value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
                placeholder="nguyenvana"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Họ tên</label>
              <input
                type="text" value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
                placeholder="Nguyễn Văn A"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
              <input
                type="email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
                placeholder="email@company.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Vai trò</label>
            <select
              value={form.role_id}
              onChange={e => setForm({ ...form, role_id: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
            >
              <option value="">— Chưa gán —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
              {isEdit ? 'Đổi mật khẩu (để trống = giữ nguyên)' : 'Mật khẩu'}
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full px-3.5 py-2.5 pr-11 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
                placeholder={isEdit ? '••••••••' : 'Nhập mật khẩu'}
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-light-400 dark:text-slate-500 hover:text-light-600 dark:hover:text-slate-300 transition-colors">
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl bg-light-50 dark:bg-dark-800/50 border border-light-100 dark:border-slate-800/40">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })}
                className="rounded border-light-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm font-bold text-light-700 dark:text-slate-300">Tài khoản đang hoạt động</span>
            </label>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20">
              <p className="text-sm text-red-600 dark:text-red-400 font-bold">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold rounded-xl text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800 transition-colors">
              Hủy
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50 shadow-lg shadow-primary-600/20">
              <Save size={16} /> {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


export default function AdminUsers() {
  const { isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [editUser, setEditUser] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const params = {}
      if (search) params.search = search
      if (filterRole) params.role_id = filterRole
      if (filterStatus !== '') params.is_active = filterStatus === 'active'
      const { data } = await api.get('/admin/users', { params })
      setUsers(data)
    } catch {}
    setLoading(false)
  }

  const fetchRoles = async () => {
    try {
      const { data } = await api.get('/admin/roles')
      setRoles(data)
    } catch {}
  }

  useEffect(() => { fetchRoles() }, [])
  useEffect(() => { fetchUsers() }, [search, filterRole, filterStatus])

  const toggleActive = async (userId) => {
    try {
      await api.post(`/admin/users/${userId}/toggle-active`)
      fetchUsers()
    } catch (err) {
      alert(err.response?.data?.detail || 'Lỗi')
    }
  }

  const deleteUser = async (userId, username) => {
    if (!confirm(`Xác nhận xóa user "${username}"? Hành động này không thể hoàn tác.`)) return
    try {
      await api.delete(`/admin/users/${userId}`)
      fetchUsers()
    } catch (err) {
      alert(err.response?.data?.detail || 'Lỗi')
    }
  }

  if (!isAdmin()) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Lock size={48} className="mx-auto text-light-300 dark:text-slate-600 mb-4" />
      </div>
    )
  }

  const activeCount = users.filter(u => u.is_active).length
  const inactiveCount = users.filter(u => !u.is_active).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Users size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">
                Quản lý Người dùng
              </h1>
              <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5">
                {users.length} người dùng &middot; {activeCount} hoạt động &middot; {inactiveCount} đã khóa
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-600/20"
          >
            <Plus size={16} /> Tạo User
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-light-100 dark:border-slate-800/40 bg-white/30 dark:bg-transparent">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-light-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Tìm theo tên, username, email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white placeholder-light-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-shadow"
            />
          </div>
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
            className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
          >
            <option value="">Tất cả vai trò</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3.5 py-2.5 rounded-xl bg-white dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="inactive">Đã khóa</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="overflow-x-auto rounded-2xl border border-light-200 dark:border-slate-700/50 bg-white dark:bg-dark-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-100 dark:border-slate-800">
                  <th className="text-left px-5 py-3.5 font-bold text-[11px] text-light-400 dark:text-slate-500 uppercase tracking-widest">Người dùng</th>
                  <th className="text-left px-5 py-3.5 font-bold text-[11px] text-light-400 dark:text-slate-500 uppercase tracking-widest">Email</th>
                  <th className="text-left px-5 py-3.5 font-bold text-[11px] text-light-400 dark:text-slate-500 uppercase tracking-widest">Vai trò</th>
                  <th className="text-center px-5 py-3.5 font-bold text-[11px] text-light-400 dark:text-slate-500 uppercase tracking-widest">Trạng thái</th>
                  <th className="text-right px-5 py-3.5 font-bold text-[11px] text-light-400 dark:text-slate-500 uppercase tracking-widest">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-50 dark:divide-slate-800/50">
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-12 text-light-400 dark:text-slate-500">Đang tải...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-light-400 dark:text-slate-500">Không tìm thấy người dùng nào</td></tr>
                ) : users.map(u => (
                  <tr key={u.id} className="hover:bg-light-50/50 dark:hover:bg-dark-800/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500/80 to-primary-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                          {(u.full_name || u.username)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-light-900 dark:text-white truncate">{u.full_name || u.username}</p>
                          <p className="text-[11px] text-light-400 dark:text-slate-500">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-light-500 dark:text-slate-400">{u.email || '—'}</td>
                    <td className="px-5 py-3.5">
                      {u.role ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 border border-primary-100 dark:border-primary-800/30">
                          <Shield size={11} /> {u.role.display_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs text-light-400 dark:text-slate-500 bg-light-100 dark:bg-dark-800 border border-light-200 dark:border-slate-700">
                          Chưa gán
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {u.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-50 dark:bg-green-900/15 text-green-600 dark:text-green-400 border border-green-100 dark:border-green-800/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Hoạt động
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 dark:bg-red-900/15 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Đã khóa
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditUser(u)}
                          className="p-2 rounded-lg text-light-400 dark:text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                          title="Chỉnh sửa"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => toggleActive(u.id)}
                          className="p-2 rounded-lg text-light-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                          title={u.is_active ? 'Khóa tài khoản' : 'Mở khóa'}
                        >
                          {u.is_active ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                        </button>
                        <button
                          onClick={() => deleteUser(u.id, u.username)}
                          className="p-2 rounded-lg text-light-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="Xóa"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modals */}
      {editUser && (
        <UserFormModal
          user={editUser}
          roles={roles}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); fetchUsers() }}
        />
      )}
      {showCreate && (
        <UserFormModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); fetchUsers() }}
        />
      )}
    </div>
  )
}
