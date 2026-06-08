// src/pages/ChatbotPage.jsx
import AppHeader from '../components/shared/AppHeader.jsx'

export default function ChatbotPage() {
  return (
    <div className="app">
      <AppHeader toolName="챗봇 모니터링" />
      <div className="job-empty" style={{ marginTop: '80px' }}>
        🚧 준비 중입니다.
      </div>
    </div>
  )
}
