// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getJobs } from '../lib/api/mailer.js'
import { setCookie, getCookie } from '../lib/auth.js'

export default function LoginPage() {
  const [pwInput, setPwInput] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (getCookie()) navigate('/', { replace: true })
  }, [navigate])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await getJobs(pwInput)
      setCookie(pwInput)
      navigate('/')
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') setError('비밀번호가 틀렸습니다.')
      else setError('연결 오류가 발생했습니다.')
    }
  }

  return (
    <div className="gate-wrapper">
      <div className="gate-card">
        <h1 className="gate-title">CS SmartHub</h1>
        <p className="gate-subtitle">CS팀 업무 지원 툴</p>
        <form onSubmit={handleLogin}>
          <input
            className="gate-input"
            type="password"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            placeholder="비밀번호"
            autoFocus
          />
          <button className="gate-btn" type="submit">확인</button>
          {error && <p className="gate-error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
