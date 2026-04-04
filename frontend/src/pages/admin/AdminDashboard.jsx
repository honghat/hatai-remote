import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  Users, Shield, KeyRound, UserCheck, UserX,
  LayoutDashboard, ArrowRight, Activity, TrendingUp,
  Lock, Settings
} from 'lucide-react'

function StatCard({ icon: Icon, label, value, sublabel, color, to }) {
  const Wrapper = to ? Link : 'div'
  return (
    <Wrapper
      to={to}
      className={`bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl p-5 transition-all duration-200 ${to ? 'hover:shadow-lg hover:border-primary-200 dark:hover:border-primary-800/50 cursor-pointer group' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
          <p className="text-3xl font-black text-light-900 dark:text-white mt-1.5 tracking-tight">{value}</p>
          {sublabel && (
            <p className="text-xs text-light-400 dark:text-slate-500 mt-1">{sublabel}</p>
          )}
        </div>
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
      {to && (
        <div className="flex items-center gap-1 mt-4 text-xs font-bold text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity">
          Xem chi tiết <ArrowRight size={12} />
        </div>
      )}
    </Wrapper>
  )
}

function RoleDistribution({ roles, users }) {
  const roleCounts = {}
  let unassigned = 0

  users.forEach(u => {
    if (u.role_id) {
      roleCounts[u.role_id] = (roleCounts[u.role_id] || 0) + 1
    } else {
      unassigned++
    }
  })

  const COLORS = [
    'bg-red-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-indigo-500',
  ]

  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl p-5">
      <h3 className="text-sm font-extrabold text-light-900 dark:text-white flex items-center gap-2 mb-4">
        <Shield size={16} className="text-primary-500" />
        Phân bổ vai trò
      </h3>

      {/* Bar visualization */}
      {users.length > 0 && (
        <div className="flex rounded-full overflow-hidden h-3 mb-4">
          {roles.map((r, i) => {
            const count = roleCounts[r.id] || 0
            if (count === 0) return null
            const pct = (count / users.length) * 100
            return (
              <div
                key={r.id}
                className={`${COLORS[i % COLORS.length]} transition-all duration-500`}
                style={{ width: `${pct}%` }}
                title={`${r.display_name}: ${count}`}
              />
            )
          })}
          {unassigned > 0 && (
            <div
              className="bg-slate-300 dark:bg-slate-600"
              style={{ width: `${(unassigned / users.length) * 100}%` }}
              title={`Chưa gán: ${unassigned}`}
            />
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {roles.map((r, i) => {
          const count = roleCounts[r.id] || 0
          return (
            <div key={r.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${COLORS[i % COLORS.length]}`} />
                <span className="text-sm font-bold text-light-700 dark:text-slate-300">{r.display_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-light-900 dark:text-white">{count}</span>
                <span className="text-[10px] text-light-400 dark:text-slate-500">
                  người dùng
                </span>
              </div>
            </div>
          )
        })}
        {unassigned > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span className="text-sm font-bold text-light-500 dark:text-slate-400">Chưa gán vai trò</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-amber-600 dark:text-amber-400">{unassigned}</span>
              <span className="text-[10px] text-light-400 dark:text-slate-500">
                người dùng
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RecentUsers({ users }) {
  const recent = users.slice(0, 8)

  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-extrabold text-light-900 dark:text-white flex items-center gap-2">
          <Activity size={16} className="text-primary-500" />
          Người dùng gần đây
        </h3>
        <Link to="/admin/users" className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline">
          Xem tất cả
        </Link>
      </div>

      <div className="space-y-2">
        {recent.map(u => (
          <div key={u.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-light-50 dark:hover:bg-dark-800/50 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
              {(u.full_name || u.username)[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-light-900 dark:text-white truncate">{u.full_name || u.username}</p>
              <p className="text-[11px] text-light-400 dark:text-slate-500 truncate">{u.email || u.username}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {u.role && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-light-100 dark:bg-dark-800 text-light-600 dark:text-slate-400 truncate max-w-[80px]">
                  {u.role.display_name}
                </span>
              )}
              {u.is_active ? (
                <span className="w-2 h-2 rounded-full bg-green-500" title="Hoạt động" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-red-500" title="Đã khóa" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PermissionMatrix({ roles }) {
  // Collect all unique resources
  const allResources = [...new Set(roles.flatMap(r => r.permissions.map(p => p.resource)))].sort()

  if (allResources.length === 0) return null

  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl p-5">
      <h3 className="text-sm font-extrabold text-light-900 dark:text-white flex items-center gap-2 mb-4">
        <KeyRound size={16} className="text-primary-500" />
        Ma trận phân quyền
      </h3>

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs min-w-[500px]">
          <thead>
            <tr className="border-b border-light-100 dark:border-slate-800">
              <th className="text-left px-2 py-2 font-bold text-light-400 dark:text-slate-500 uppercase tracking-wider">Module</th>
              {roles.map(r => (
                <th key={r.id} className="text-center px-2 py-2 font-bold text-light-400 dark:text-slate-500 uppercase tracking-wider whitespace-nowrap">
                  {r.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-light-50 dark:divide-slate-800/50">
            {allResources.map(resource => (
              <tr key={resource} className="hover:bg-light-50/50 dark:hover:bg-dark-800/30">
                <td className="px-2 py-2 font-bold text-light-700 dark:text-slate-300 uppercase">{resource}</td>
                {roles.map(r => {
                  const perms = r.permissions.filter(p => p.resource === resource).map(p => p.action)
                  const hasManage = perms.includes('manage')
                  return (
                    <td key={r.id} className="text-center px-2 py-2">
                      {hasManage ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-bold text-[10px]">
                          FULL
                        </span>
                      ) : perms.length > 0 ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold text-[10px]">
                          {perms.join(', ')}
                        </span>
                      ) : (
                        <span className="text-light-200 dark:text-slate-700">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


export default function AdminDashboard() {
  const { isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [usersRes, rolesRes, permsRes] = await Promise.all([
          api.get('/admin/users'),
          api.get('/admin/roles'),
          api.get('/admin/permissions'),
        ])
        setUsers(usersRes.data)
        setRoles(rolesRes.data)
        setPermissions(permsRes.data)
      } catch {}
      setLoading(false)
    }
    fetchAll()
  }, [])

  if (!isAdmin()) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Lock size={48} className="mx-auto text-light-300 dark:text-slate-600 mb-4" />
          <p className="text-light-500 dark:text-slate-400 font-bold">Bạn không có quyền truy cập</p>
        </div>
      </div>
    )
  }

  const activeUsers = users.filter(u => u.is_active).length
  const inactiveUsers = users.filter(u => !u.is_active).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg">
            <LayoutDashboard size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">
              Quản trị Hệ thống
            </h1>
            <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5">
              Tổng quan người dùng, phân quyền và cấu hình hệ thống
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {loading ? (
            <div className="text-center py-12 text-light-400 dark:text-slate-500">Đang tải dữ liệu...</div>
          ) : (
            <>
              {/* Stat Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={Users}
                  label="Tổng Người dùng"
                  value={users.length}
                  sublabel={`${activeUsers} hoạt động`}
                  color="from-blue-500 to-blue-600"
                  to="/admin/users"
                />
                <StatCard
                  icon={UserCheck}
                  label="Đang hoạt động"
                  value={activeUsers}
                  color="from-emerald-500 to-emerald-600"
                  to="/admin/users"
                />
                <StatCard
                  icon={Shield}
                  label="Vai trò"
                  value={roles.length}
                  sublabel={`${roles.filter(r => r.is_system).length} hệ thống`}
                  color="from-purple-500 to-purple-600"
                  to="/admin/roles"
                />
                <StatCard
                  icon={KeyRound}
                  label="Quyền hạn"
                  value={permissions.length}
                  sublabel={`${[...new Set(permissions.map(p => p.resource))].length} module`}
                  color="from-amber-500 to-amber-600"
                  to="/admin/roles"
                />
              </div>

              {/* Charts Row */}
              <div className="grid lg:grid-cols-2 gap-6">
                <RoleDistribution roles={roles} users={users} />
                <RecentUsers users={users} />
              </div>

              {/* Permission Matrix */}
              <PermissionMatrix roles={roles} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
