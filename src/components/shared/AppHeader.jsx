import { useNavigate } from 'react-router-dom'
import { ChevronLeft, LogOut } from 'lucide-react'
import { clearCookie } from '../../lib/auth.js'

export default function AppHeader({ toolName, children }) {
  const navigate = useNavigate()

  const handleLogout = () => {
    clearCookie()
    navigate('/login')
  }

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button className="hub-back-btn" onClick={() => navigate('/')}>
          <ChevronLeft size={14} /> CS SmartHub
        </button>
        <span className="hub-divider">|</span>
        <span className="app-title">{toolName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {children}
        <button className="hub-logout-btn" onClick={handleLogout}>
          <LogOut size={13} /> 로그아웃
        </button>
      </div>
    </header>
  )
}
