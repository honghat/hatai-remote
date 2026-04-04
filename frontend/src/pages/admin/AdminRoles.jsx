import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  Shield, Plus, Edit3, Trash2, X, Save, Lock, KeyRound,
  ChevronDown, ChevronRight, Check, Users, Eye, CheckCircle2, RefreshCw
} from 'lucide-react'

const MODULE_LABELS = {
  users: 'Người dùng',
  chat: 'Chat AI',
  agent: 'AI Agent',
  tasks: 'Tác vụ nền',
  schedules: 'Lịch định kỳ',
  terminal: 'SSH Terminal',
  code: 'HatAI Code',
  skills: 'Agent Skills',
  brain: 'Brain & Memory',
  erp: 'ERP',
  accounting: 'Kế toán & Tài chính',
}

const ACTION_COLORS = {
  read: 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/30',
  write: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/30',
  execute: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/30',
  manage: 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800/30',
  delete: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/30',
  approve: 'bg-cyan-100 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800/30',
}

function RoleDetailModal({ role, onClose }) {
  // Group permissions by resource
  const grouped = role.permissions.reduce((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = []
    acc[p.resource].push(p)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-dark-900 rounded-2xl shadow-2xl w-full max-w-xl mx-4 border border-light-200 dark:border-slate-700 overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-100 dark:border-slate-800 bg-light-50/50 dark:bg-dark-800/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
              <Shield size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-light-900 dark:text-white">{role.display_name}</h3>
              <p className="text-[11px] text-light-400 dark:text-slate-500 font-mono">{role.name} &middot; {role.permissions.length} quyền</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-light-100 dark:hover:bg-dark-800 text-light-400 dark:text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {role.description && (
            <p className="text-sm text-light-500 dark:text-slate-400 leading-relaxed">{role.description}</p>
          )}

          {Object.keys(grouped).length === 0 ? (
            <p className="text-center py-8 text-light-400 dark:text-slate-500">Không có quyền nào</p>
          ) : (
            Object.entries(grouped).map(([resource, perms]) => (
              <div key={resource} className="rounded-xl border border-light-200 dark:border-slate-700/50 overflow-hidden">
                <div className="flex items-center gap-2.5 px-4 py-2.5 bg-light-50 dark:bg-dark-800/50">
                  <CheckCircle2 size={14} className="text-primary-500" />
                  <span className="text-sm font-extrabold text-light-900 dark:text-white uppercase tracking-wide">
                    {MODULE_LABELS[resource] || resource}
                  </span>
                  <span className="text-[10px] text-light-400 dark:text-slate-500 ml-auto">{perms.length} quyền</span>
                </div>
                <div className="px-4 py-3 flex flex-wrap gap-2">
                  {perms.map(p => (
                    <div key={p.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border ${ACTION_COLORS[p.action] || ACTION_COLORS.read}`}>
                      <Check size={11} />
                      {p.display_name}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}


function RoleFormModal({ role, permissions, onClose, onSaved }) {
  const isEdit = !!role
  const [form, setForm] = useState({
    name: role?.name || '',
    display_name: role?.display_name || '',
    description: role?.description || '',
    permission_ids: role?.permissions?.map(p => p.id) || [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedResources, setExpandedResources] = useState({})

  // Group permissions by resource
  const grouped = permissions.reduce((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = []
    acc[p.resource].push(p)
    return acc
  }, {})

  const togglePerm = (id) => {
    setForm(f => ({
      ...f,
      permission_ids: f.permission_ids.includes(id)
        ? f.permission_ids.filter(x => x !== id)
        : [...f.permission_ids, id]
    }))
  }

  const toggleResource = (resource) => {
    const resourcePerms = grouped[resource].map(p => p.id)
    const allSelected = resourcePerms.every(id => form.permission_ids.includes(id))
    setForm(f => ({
      ...f,
      permission_ids: allSelected
        ? f.permission_ids.filter(id => !resourcePerms.includes(id))
        : [...new Set([...f.permission_ids, ...resourcePerms])]
    }))
  }

  const toggleExpand = (resource) => {
    setExpandedResources(prev => ({ ...prev, [resource]: !prev[resource] }))
  }

  const selectAll = () => {
    setForm(f => ({ ...f, permission_ids: permissions.map(p => p.id) }))
  }

  const deselectAll = () => {
    setForm(f => ({ ...f, permission_ids: [] }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await api.put(`/admin/roles/${role.id}`, form)
      } else {
        await api.post('/admin/roles', form)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi lưu role')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-dark-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 border border-light-200 dark:border-slate-700 overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-100 dark:border-slate-800 bg-light-50/50 dark:bg-dark-800/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <Shield size={16} className="text-white" />
            </div>
            <h3 className="text-base font-extrabold text-light-900 dark:text-white">
              {isEdit ? 'Chỉnh sửa Vai trò' : 'Tạo Vai trò Mới'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-light-100 dark:hover:bg-dark-800 text-light-400 dark:text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Tên hệ thống (slug)</label>
              <input
                type="text" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                disabled={isEdit && role.is_system}
                className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 transition-shadow"
                placeholder="erp_accountant"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Tên hiển thị</label>
              <input
                type="text" required value={form.display_name}
                onChange={e => setForm({ ...form, display_name: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                placeholder="Kế toán viên"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-light-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Mô tả</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-xl bg-light-50 dark:bg-dark-800 border border-light-200 dark:border-slate-700 text-sm text-light-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 resize-none transition-shadow"
              placeholder="Mô tả vai trò và phạm vi quyền hạn..."
            />
          </div>

          {/* Permission Matrix */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-light-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <KeyRound size={13} /> Phân quyền theo Module
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={selectAll} className="text-[11px] font-bold text-primary-600 dark:text-primary-400 hover:underline">
                  Chọn tất cả
                </button>
                <span className="text-light-200 dark:text-slate-700">|</span>
                <button type="button" onClick={deselectAll} className="text-[11px] font-bold text-light-400 dark:text-slate-500 hover:underline">
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {Object.entries(grouped).map(([resource, perms]) => {
                const allSelected = perms.every(p => form.permission_ids.includes(p.id))
                const someSelected = perms.some(p => form.permission_ids.includes(p.id))
                const isExpanded = expandedResources[resource] !== false // default open

                return (
                  <div key={resource} className={`rounded-xl border transition-colors ${
                    allSelected
                      ? 'bg-primary-50/50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800/30'
                      : someSelected
                        ? 'bg-light-50/50 dark:bg-dark-800/30 border-light-200 dark:border-slate-700/50'
                        : 'bg-light-50/30 dark:bg-dark-800/20 border-light-100 dark:border-slate-800/40'
                  }`}>
                    <div className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer" onClick={() => toggleExpand(resource)}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                        onChange={(e) => { e.stopPropagation(); toggleResource(resource) }}
                        onClick={e => e.stopPropagation()}
                        className="rounded border-light-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm font-extrabold text-light-900 dark:text-white flex-1 uppercase tracking-wide">
                        {MODULE_LABELS[resource] || resource}
                      </span>
                      <span className="text-[10px] text-light-400 dark:text-slate-500 mr-1">
                        {perms.filter(p => form.permission_ids.includes(p.id)).length}/{perms.length}
                      </span>
                      {isExpanded ? <ChevronDown size={14} className="text-light-400 dark:text-slate-500" /> : <ChevronRight size={14} className="text-light-400 dark:text-slate-500" />}
                    </div>

                    {isExpanded && (
                      <div className="flex flex-wrap gap-2 px-3.5 pb-3 pt-0.5 ml-6">
                        {perms.map(p => (
                          <label key={p.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-bold transition-colors ${
                            form.permission_ids.includes(p.id)
                              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                              : 'bg-white dark:bg-dark-900 text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800'
                          }`}>
                            <input
                              type="checkbox"
                              checked={form.permission_ids.includes(p.id)}
                              onChange={() => togglePerm(p.id)}
                              className="sr-only"
                            />
                            {form.permission_ids.includes(p.id) && <Check size={12} />}
                            {p.display_name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20">
              <p className="text-sm text-red-600 dark:text-red-400 font-bold">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-light-100 dark:border-slate-800 bg-light-50/30 dark:bg-dark-800/20 flex-shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold rounded-xl text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800 transition-colors">
            Hủy
          </button>
          <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50 shadow-lg shadow-primary-600/20">
            <Save size={16} /> {saving ? 'Đang lưu...' : 'Lưu vai trò'}
          </button>
        </div>
      </div>
    </div>
  )
}


export default function AdminRoles() {
  const { isAdmin } = useAuth()
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [editRole, setEditRole] = useState(null)
  const [viewRole, setViewRole] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.get('/admin/roles'),
        api.get('/admin/permissions'),
      ])
      setRoles(rolesRes.data)
      setPermissions(permsRes.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const deleteRole = async (roleId, roleName) => {
    if (!confirm(`Xác nhận xóa vai trò "${roleName}"?`)) return
    try {
      await api.delete(`/admin/roles/${roleId}`)
      fetchData()
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

  // Group permissions by resource for display
  const allResources = [...new Set(permissions.map(p => p.resource))].sort()

  const ROLE_COLORS = [
    'from-red-500 to-red-600',
    'from-blue-500 to-blue-600',
    'from-emerald-500 to-emerald-600',
    'from-amber-500 to-amber-600',
    'from-purple-500 to-purple-600',
    'from-cyan-500 to-cyan-600',
    'from-pink-500 to-pink-600',
    'from-indigo-500 to-indigo-600',
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg">
              <KeyRound size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">
                Vai trò & Phân quyền
              </h1>
              <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5">
                {roles.length} vai trò &middot; {permissions.length} quyền trên {allResources.length} module
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-600/20"
            >
              <Plus size={16} /> Tạo vai trò
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {loading ? (
            <div className="text-center py-12 text-light-400 dark:text-slate-500">Đang tải...</div>
          ) : (
            <>
              {/* Role Cards */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {roles.map((role, idx) => {
                  const gradient = ROLE_COLORS[idx % ROLE_COLORS.length]
                  return (
                    <div key={role.id} className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl overflow-hidden group hover:shadow-lg transition-shadow">
                      {/* Card Header */}
                      <div className={`px-5 py-4 bg-gradient-to-r ${gradient} relative`}>
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-extrabold text-white text-base flex items-center gap-2">
                              {role.display_name}
                            </h4>
                            <p className="text-white/70 text-xs mt-0.5 font-mono">{role.name}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {role.is_system && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-white/20 text-white rounded font-bold uppercase backdrop-blur-sm">
                                System
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-5 space-y-3">
                        {role.description && (
                          <p className="text-xs text-light-500 dark:text-slate-400 leading-relaxed">{role.description}</p>
                        )}

                        <div>
                          <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                            {role.permissions.length} quyền &middot; {[...new Set(role.permissions.map(p => p.resource))].length} module
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {role.permissions.slice(0, 6).map(p => (
                              <span key={p.id} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${ACTION_COLORS[p.action] || ACTION_COLORS.read}`}>
                                {p.resource}:{p.action}
                              </span>
                            ))}
                            {role.permissions.length > 6 && (
                              <button
                                onClick={() => setViewRole(role)}
                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/30 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors cursor-pointer"
                              >
                                +{role.permissions.length - 6} xem thêm
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer */}
                      <div className="px-5 py-3 border-t border-light-100 dark:border-slate-800/50 flex items-center justify-between">
                        <button
                          onClick={() => setViewRole(role)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-light-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                        >
                          <Eye size={13} /> Xem quyền
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditRole(role)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                          >
                            <Edit3 size={13} /> Sửa
                          </button>
                          {!role.is_system && (
                            <button
                              onClick={() => deleteRole(role.id, role.display_name)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              <Trash2 size={13} /> Xóa
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {viewRole && (
        <RoleDetailModal role={viewRole} onClose={() => setViewRole(null)} />
      )}
      {editRole && (
        <RoleFormModal
          role={editRole}
          permissions={permissions}
          onClose={() => setEditRole(null)}
          onSaved={() => { setEditRole(null); fetchData() }}
        />
      )}
      {showCreate && (
        <RoleFormModal
          permissions={permissions}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); fetchData() }}
        />
      )}
    </div>
  )
}
