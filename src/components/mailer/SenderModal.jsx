import { useState } from 'react'

export default function SenderModal({ onSubmit, onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({ email, app_password: password })
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2 className="modal-title">Gmail 계정 추가</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">이메일</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="example@gmail.com"
              required
            />
          </div>
          <div className="form-field">
            <label className="form-label">앱 비밀번호</label>
            <div className="pw-input-wrap">
              <input
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx"
                required
                style={{ paddingRight: '58px' }}
              />
              <button
                type="button"
                className="pw-toggle-btn"
                onClick={() => setShowPassword(v => !v)}
              >
                {showPassword ? '숨기기' : '보기'}
              </button>
            </div>
            <p className="form-hint">Google 계정 → 보안 → 앱 비밀번호에서 생성하세요.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onClose}>취소</button>
            <button type="submit" className="modal-submit">저장</button>
          </div>
        </form>
      </div>
    </div>
  )
}
