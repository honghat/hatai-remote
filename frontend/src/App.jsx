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
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Route>
            <Route path="/project" element={<PrivateRoute><Project /></PrivateRoute>} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
