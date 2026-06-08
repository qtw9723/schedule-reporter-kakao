// src/pages/HubPage.jsx
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { clearCookie } from '../lib/auth.js'

const TOOLS = [
  {
    id: 'mailer',
    icon: '📧',
    name: 'Mailer',
    description: '메일 발송 스케줄 관리',
    path: '/mailer',
    active: true,
  },
  {
    id: 'grafana',
    icon: '📊',
    name: 'Grafana 리포트',
    description: '모니터링 리포트 생성',
    path: '/grafana',
    active: true,
  },
  {
    id: 'chatbot',
    icon: '🤖',
    name: '챗봇 모니터링',
    description: '챗봇 활성화 현황 추적',
    path: '/chatbot',
    active: false,
  },
]

export default function HubPage() {
  const navigate = useNavigate()

  const handleLogout = () => {
    clearCookie()
    navigate('/login')
  }

  return (
    <div className="hub-wrapper">
      <header className="hub-header">
        <span className="hub-title">CS SmartHub</span>
        <button className="hub-logout-btn" onClick={handleLogout}>
          <LogOut size={13} /> 로그아웃
        </button>
      </header>

      <main className="hub-main">
        <p className="hub-subtitle">어떤 툴을 사용할까요?</p>
        <div className="hub-grid">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              className={`hub-card${tool.active ? '' : ' hub-card-disabled'}`}
              onClick={() => tool.active && navigate(tool.path)}
              disabled={!tool.active}
            >
              {!tool.active && <span className="hub-badge">준비 중</span>}
              <span className="hub-card-icon">{tool.icon}</span>
              <span className="hub-card-name">{tool.name}</span>
              <span className="hub-card-desc">{tool.description}</span>
            </button>
          ))}
          <div className="hub-card hub-card-empty">
            <span className="hub-card-icon">＋</span>
            <span className="hub-card-name" style={{ color: '#404050' }}>추가 예정</span>
          </div>
        </div>
      </main>
    </div>
  )
}
