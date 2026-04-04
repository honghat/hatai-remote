import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import PrivateRoute from './components/PrivateRoute'
import Login from './pages/Login'
import Layout from './pages/Layout'
import Chat from './pages/Chat'
import Brain from './pages/Brain'
import Tasks from './pages/Tasks'
import Schedules from './pages/Schedules'
import TerminalPage from './pages/Terminal'
import Skills from './pages/Skills'
import Project from './pages/Project'
import ERP from './pages/ERP'
import Accounting from './pages/Accounting'
import Profile from './pages/Profile'

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsers from './pages/admin/AdminUsers'
import AdminRoles from './pages/admin/AdminRoles'
import AdminSettings from './pages/admin/AdminSettings'
import ActivityLogs from './pages/admin/ActivityLogs'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="chat" element={<Chat />} />
              <Route path="brain" element={<Brain />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="schedules" element={<Schedules />} />
              <Route path="terminal" element={<TerminalPage />} />
              <Route path="skills" element={<Skills />} />
              <Route path="erp" element={<ERP />} />
              <Route path="accounting" element={<Accounting />} />
              <Route path="project" element={<Project />} />
              <Route path="profile" element={<Profile />} />

              {/* Admin routes */}
              <Route path="admin" element={<AdminDashboard />} />
              <Route path="admin/users" element={<AdminUsers />} />
              <Route path="admin/roles" element={<AdminRoles />} />
              <Route path="admin/settings" element={<AdminSettings />} />
              <Route path="admin/activities" element={<ActivityLogs />} />

              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Route>

            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
