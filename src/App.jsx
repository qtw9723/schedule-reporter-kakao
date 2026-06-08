// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import HubPage from './pages/HubPage.jsx'
import MailerPage from './pages/MailerPage.jsx'
import GrafanaPage from './pages/GrafanaPage.jsx'
import ChatbotPage from './pages/ChatbotPage.jsx'
import ProtectedRoute from './components/shared/ProtectedRoute.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><HubPage /></ProtectedRoute>} />
        <Route path="/mailer" element={<ProtectedRoute><MailerPage /></ProtectedRoute>} />
        <Route path="/grafana" element={<ProtectedRoute><GrafanaPage /></ProtectedRoute>} />
        <Route path="/chatbot" element={<ProtectedRoute><ChatbotPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
