import { useState, useMemo, useEffect } from 'react'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import api from '../api'
import {
  Bot, Code2, LogOut, Menu, X, Zap, Brain,
  Sun, Moon, ListTodo, Puzzle, Clock, Monitor, User,
  Users, Shield, LayoutDashboard, Settings, Activity,
  Building2, Calculator, ChevronDown, ChevronRight,
  FileText, BarChart3, KeyRound
} from 'lucide-react'
import ModelStatusBadge from '../components/ModelStatusBadge'

/**
 * Navigation phân nhóm theo module hệ thống.
 * Mỗi section chỉ hiện khi user có ít nhất 1 quyền trong nhóm đó.
 * Admin section chỉ hiện cho role admin.
 */
const NAV_SECTIONS = [
  {
    key: 'ai',
    label: 'AI & Tự động hóa',
    icon: Zap,
    items: [
      { path: '/chat', label: 'AI Agent', icon: Zap, permission: ['chat', 'read'] },
      { path: '/tasks', label: 'Tác vụ nền', icon: ListTodo, permission: ['tasks', 'read'] },
      { path: '/schedules', label: 'Lịch định kỳ', icon: Clock, permission: ['schedules', 'read'] },
    ],
  },
  {
    key: 'dev',
    label: 'Phát triển',
    icon: Code2,
    items: [
      { path: '/terminal', label: 'SSH Terminal', icon: Monitor, permission: ['terminal', 'read'] },
      { path: '/project', label: 'HatAI Code', icon: Code2, permission: ['code', 'read'] },
    ],
  },
  {
    key: 'knowledge',
    label: 'Trí nhớ Agent',
    icon: Brain,
    items: [
      { path: '/brain', label: 'Tổng quan', icon: Brain, permission: ['brain', 'read'] },
    ],
  },
  {
    key: 'erp',
    label: 'ERP',
    icon: Building2,
    items: [
      { path: '/erp', label: 'Tổng quan', icon: Building2, permission: ['erp', 'read'] },
      { path: '/accounting', label: 'Kế toán & Tài chính', icon: Calculator, permission: ['accounting', 'read'] },
    ],
  },
  {
    key: 'admin',
    label: 'Quản trị hệ thống',
    icon: Shield,
    adminOnly: true,
    items: [
      { path: '/admin', label: 'Tổng quan', icon: LayoutDashboard, exact: true },
      { path: '/admin/users', label: 'Người dùng', icon: Users },
      { path: '/admin/roles', label: 'Vai trò & Quyền', icon: KeyRound },
      { path: '/admin/activities', label: 'Lịch sử hoạt động', icon: Activity },
      { path: '/admin/settings', label: 'Cấu hình', icon: Settings },
    ],
  },
]

// Colors per role for the badge
const ROLE_COLORS = {
  admin: 'from-emerald-500 to-teal-500', // Green for Admin
  manager: 'from-blue-500 to-cyan-500',
  operator: 'from-emerald-500 to-teal-500',
  viewer: 'from-slate-400 to-slate-500',
}

function RoleBadge({ user, isCollapsed }) {
  const roleName = user?.role?.name || 'viewer'
  const displayName = user?.role?.display_name || 'Chưa gán'
  const gradient = ROLE_COLORS[roleName] || ROLE_COLORS.viewer

  if (isCollapsed) {
    return (
      <div className="px-3 py-2 flex justify-center" title={displayName}>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
          <Shield size={14} className="text-white" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-3 p-3 rounded-xl bg-light-50/80 dark:bg-dark-800/50 border border-light-100 dark:border-slate-800/40 relative group">
      <div className="flex items-center gap-2.5">
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 duration-300 overflow-hidden`}>
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-xs font-black uppercase">
              {(user?.full_name || user?.username || '?')[0]}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold truncate leading-tight ${roleName === 'admin' ? 'text-emerald-600 dark:text-emerald-400' : 'text-light-900 dark:text-white'}`}>
            {user?.full_name || user?.username}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${roleName === 'admin' ? 'bg-emerald-500 animate-pulse' : `bg-gradient-to-br ${gradient}`}`} />
            <span className={`text-[10px] font-bold uppercase tracking-widest truncate ${roleName === 'admin' ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-light-400 dark:text-slate-500'}`}>
              {displayName}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function NavSection({ section, isCollapsed, location, hasPermission, isAdmin, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)

  // Filter items by permission
  const visibleItems = section.items.filter(item => {
    if (section.adminOnly) return true // admin items don't need per-item check
    if (!item.permission) return true
    return hasPermission(item.permission[0], item.permission[1])
  })

  if (visibleItems.length === 0) return null
  if (section.adminOnly && !isAdmin) return null

  const isActive = (item) => item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path)
  const isAnyActive = visibleItems.some(isActive)

  // IF COLLAPSED: always show icons in a stack
  if (isCollapsed) {
    return (
      <div className="space-y-0.5">
        {visibleItems.map((item) => {
          const active = isActive(item)
          const Icon = item.icon
          return (
            <Link
              key={item.path}
              to={item.path}
              title={item.label}
              className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all duration-150
                ${active
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                  : 'text-light-400 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50'
                }`}
            >
              <Icon size={18} />
            </Link>
          )
        })}
      </div>
    )
  }

  // IF ONLY 1 ITEM: render directly as a main link (hide group header)
  if (visibleItems.length === 1) {
    const item = visibleItems[0]
    const active = isActive(item)
    const Icon = item.icon
    return (
      <Link
        to={item.path}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150 font-bold text-[13px]
          ${active
            ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
            : 'text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50'
          }`}
      >
        <Icon size={16} className="flex-shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  // IF >= 2 ITEMS: render with expandable header
  return (
    <div>
      {/* Section Header */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[11px] font-extrabold uppercase tracking-widest transition-colors
          ${isAnyActive
            ? 'text-primary-600 dark:text-primary-400'
            : 'text-light-300 dark:text-slate-600 hover:text-light-500 dark:hover:text-slate-400'
          }`}
      >
        <section.icon size={13} className="flex-shrink-0 opacity-60" />
        <span className="flex-1 text-left truncate">{section.label}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {/* Section Items */}
      {open && (
        <div className="mt-0.5 space-y-0.5 animate-fade-in">
          {visibleItems.map((item) => {
            const active = isActive(item)
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2.5 pl-8 pr-3 py-2 rounded-xl transition-all duration-150 font-bold text-[13px]
                  ${active
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                    : 'text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50'
                  }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, logout, isAdmin, hasPermission } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(isAdmin())
  const [aiReady, setAiReady] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const checkAiStatus = async () => {
    try {
      const { data } = await api.get('/ai/status')
      const active = data.provider === 'gemini' ? data.gemini?.ready 
                  : data.provider === 'ollama' ? data.ollama?.ready 
                  : data.provider === 'openai' ? data.openai?.ready 
                  : data.local?.loaded
      setAiReady(active)
    } catch { setAiReady(false) }
  }

  useEffect(() => {
    checkAiStatus()
    const id = setInterval(checkAiStatus, 10000)
    return () => clearInterval(id)
  }, [])

  // Determine which sections are open by default based on current path
  const defaultOpenSections = useMemo(() => {
    const map = {}
    NAV_SECTIONS.forEach(s => {
      map[s.key] = s.items.some(item =>
        item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path)
      )
    })
    // Always open the first section by default
    if (!Object.values(map).some(Boolean)) map['ai'] = true
    return map
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isAdminUser = isAdmin()

  return (
    <div className="flex h-screen overflow-hidden bg-light-50 dark:bg-dark-950">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden animate-fade-in backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`flex-shrink-0 flex flex-col bg-white dark:bg-dark-900 border-r border-light-200 dark:border-slate-800/60 transition-all duration-300 ease-in-out h-full overflow-x-hidden z-20
          ${sidebarOpen ? 'w-[260px]' : 'w-[72px]'} 
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Logo Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-light-200 dark:border-slate-800/60 bg-light-50/30 dark:bg-transparent">
          <div className="flex-shrink-0 w-9 h-9 bg-primary-600 dark:bg-primary-600/20 border border-primary-500/20 dark:border-primary-500/30 rounded-xl flex items-center justify-center shadow-lg shadow-primary-600/10 dark:shadow-none mx-auto relative">
            <Bot size={20} className="text-white dark:text-primary-400" />
            {/* Status dot for icon mode */}
            {!sidebarOpen && (
              <div className="absolute -top-0.5 -right-0.5">
                <span className="flex h-2 w-2 relative">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${aiReady ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 border border-white dark:border-dark-900 ${aiReady ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                </span>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <div className="min-w-0 animate-fade-in flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="font-extrabold text-light-900 dark:text-white text-base tracking-tight leading-none truncate">HatAI</p>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${aiReady ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`} />
              </div>
              <p className="text-[10px] font-bold text-primary-600 dark:text-primary-500 mt-1 uppercase tracking-widest truncate">All In One</p>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto p-1.5 text-light-400 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg transition-all flex-shrink-0"
            id="sidebar-toggle"
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Profile Sidebar Section - Integrated with Theme/Logout */}
        <div className="py-3">
          <RoleBadge user={user} isCollapsed={!sidebarOpen} />
          
          {/* Action Buttons right under profile if expanded, OR small icons if collapsed */}
          <div className={`mt-2 px-3 flex gap-2 ${sidebarOpen ? 'flex-row' : 'flex-col items-center'}`}>
            <Link
                to="/profile"
                className={`flex items-center justify-center gap-2 rounded-xl transition-all duration-300 text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50 ${sidebarOpen ? 'flex-1 px-3 py-2 border border-light-100 dark:border-slate-800/40 bg-white dark:bg-dark-900/50' : 'p-2.5 border border-light-100/50 dark:border-slate-800/30'}`}
                title="Hồ sơ cá nhân"
            >
                <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    <User size={14} />
                </div>
            </Link>

            <button
                onClick={toggleTheme}
                className={`flex items-center justify-center gap-2 rounded-xl transition-all duration-300 text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50 ${sidebarOpen ? 'p-2 border border-light-100 dark:border-slate-800/40 bg-white dark:bg-dark-900/50' : 'p-2.5 border border-light-100/50 dark:border-slate-800/30'}`}
                title={theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            >
                <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </div>
            </button>

            <button
                onClick={handleLogout}
                className={`flex items-center justify-center gap-2 rounded-xl transition-all duration-300 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 ${sidebarOpen ? 'flex-1 px-3 py-2 border border-red-500/10 bg-white dark:bg-dark-900/50' : 'p-2.5 border border-red-500/10'}`}
                title="Đăng xuất"
            >
                <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    <LogOut size={14} />
                </div>
            </button>
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          {NAV_SECTIONS.map(section => (
            <NavSection
              key={section.key}
              section={section}
              isCollapsed={!sidebarOpen}
              location={location}
              hasPermission={hasPermission}
              isAdmin={isAdminUser}
              defaultOpen={defaultOpenSections[section.key]}
            />
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col relative transition-all duration-300 pt-[57px] md:pt-0">
        {/* Mobile Header */}
        <div className="flex md:hidden items-center gap-3 px-4 h-[57px] bg-white/76 dark:bg-dark-900/76 border-b border-light-200 dark:border-slate-800/60 backdrop-blur-md fixed top-0 left-0 right-0 z-50">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 text-light-600 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg transition-all"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shadow-lg shadow-primary-500/20 relative">
              <Bot size={16} className="text-white" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-dark-900 bg-emerald-500" />
            </div>
            <div className="flex items-center gap-1.5">
               <span className="font-extrabold text-light-900 dark:text-white tracking-tight uppercase text-xs">HatAI</span>
               <div className={`w-1 h-1 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </div>
          </div>
          <div className="flex-1" />
        </div>

        <Outlet />
      </main>
    </div>
  )
}
