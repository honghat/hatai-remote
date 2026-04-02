import { useState } from 'react'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import {
  Bot, MessageSquare, Code2, Sparkles, Settings,
  LogOut, Menu, X, ChevronRight, Cpu, Wifi, Zap, ClipboardList, Activity, Brain,
  Sun, Moon, ListTodo, Puzzle, Clock, Monitor
} from 'lucide-react'
import ModelStatusBadge from '../components/ModelStatusBadge'

const NAV_ITEMS = [
  { path: '/chat', label: 'AI Agent', icon: Zap },
  { path: '/tasks', label: 'Background Tasks', icon: ListTodo },
  { path: '/schedules', label: 'Tác vụ Định kỳ', icon: Clock },
  { path: '/terminal', label: 'SSH Terminal', icon: Monitor },
  { path: '/project', label: 'HatAI Code', icon: Code2 },
  { path: '/skills', label: 'Agent Skills', icon: Puzzle },
  { path: '/brain', label: 'Brain & Memory', icon: Brain },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-light-50 dark:bg-dark-950">
      {/* Mobile Backdrop Overlay - only visible when sidebar is open on mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden animate-fade-in backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-white dark:bg-dark-900/90 border-r border-light-200 dark:border-slate-800/60 transition-all duration-150 ease-out fixed md:relative z-50 h-full
          ${sidebarOpen ? 'w-[280px] md:w-60 translate-x-0' : 'w-16 -translate-x-full md:translate-x-0 md:w-16'}`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-6 border-b border-light-200 dark:border-slate-800/60 bg-light-50/30 dark:bg-transparent">
          <div className="flex-shrink-0 w-9 h-9 bg-primary-600 dark:bg-primary-600/20 border border-primary-500/20 dark:border-primary-500/30 rounded-xl flex items-center justify-center shadow-lg shadow-primary-600/10 dark:shadow-none">
            <Bot size={20} className="text-white dark:text-primary-400" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0 animate-fade-in">
              <p className="font-extrabold text-light-900 dark:text-white text-base tracking-tight leading-none">HatAI</p>
              <p className="text-[10px] font-bold text-primary-600 dark:text-primary-500 mt-1 uppercase tracking-widest">Remote</p>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto p-1.5 text-light-400 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg transition-all flex-shrink-0 md:hidden"
          >
             <X size={18} />
          </button>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto p-1.5 text-light-400 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg transition-all flex-shrink-0 hidden md:flex"
            id="sidebar-toggle"
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Model Status */}
        <div className="px-3 pt-3">
          <ModelStatusBadge isCollapsed={!sidebarOpen} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              id={`nav-${label.toLowerCase().replace(' ', '-')}`}
              className={`sidebar-item flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 font-bold text-sm
                ${location.pathname.startsWith(path) 
                  ? 'active bg-primary-600 text-white shadow-lg shadow-primary-600/20' 
                  : 'text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50'}`}
            >
              <Icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span className="truncate tracking-tight">{label}</span>}
            </Link>
          ))}
        </nav>

        {/* User Footer */}
        <div className="border-t border-light-200 dark:border-slate-800/60 p-4 space-y-2 bg-light-50/30 dark:bg-transparent">
          {sidebarOpen && user && (
            <div className="px-3 py-1 mb-2 animate-fade-in">
              <p className="text-sm font-bold text-light-900 dark:text-white truncate">{user.full_name || user.username}</p>
              <p className="text-[10px] font-bold text-light-400 dark:text-slate-600 uppercase tracking-widest mt-0.5">
                {user.role_id === 1 ? 'Administrator' : 'Operator'}
              </p>
            </div>
          )}
          
          <div className="space-y-1">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              id="theme-toggle-btn"
              className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-bold transition-all duration-300 text-light-500 dark:text-slate-500 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-800/50"
              title={theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            >
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </div>
              {sidebarOpen && <span>{theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}</span>}
            </button>

            <button
              onClick={handleLogout}
              id="logout-btn"
              className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm font-bold transition-all duration-300 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/10"
            >
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                <LogOut size={18} />
              </div>
              {sidebarOpen && <span>Đăng xuất</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {/* Mobile Header - only visible on mobile when sidebar is closed */}
        <div className="flex md:hidden items-center gap-3 px-4 py-3 bg-white/70 dark:bg-dark-900/70 border-b border-light-200 dark:border-slate-800/60 backdrop-blur-md sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 text-light-600 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-800 rounded-lg transition-all"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Bot size={16} className="text-white" />
            </div>
            <span className="font-extrabold text-light-900 dark:text-white tracking-tight uppercase text-xs">HatAI</span>
          </div>
          <div className="flex-1" />
          <ModelStatusBadge isCollapsed={true} />
        </div>
        
        <Outlet />
      </main>
    </div>
  )
}
