// src/components/grafana/GrafanaSettings.jsx
import { useState, useEffect, useCallback } from 'react'
import TagInput from '../mailer/TagInput.jsx'
import { getSettings, updateSettings } from '../../lib/api/grafana.js'
import { getCookie, clearCookie } from '../../lib/auth.js'

export default function GrafanaSettings() {
  const password = getCookie()
  const [recipients, setRecipients] = useState([])
  const [sendHour, setSendHour] = useState(9)
  const [enabled, setEnabled] = useState(true)
  const [logLagHours, setLogLagHours] = useState(3)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getSettings(password)
      setRecipients(s.recipients ?? [])
      setSendHour(s.send_hour ?? 9)
      setEnabled(!!s.enabled)
      setLogLagHours(s.log_lag_hours ?? 3)
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') clearCookie()
      else setError('설정을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [password])

  useEffect(() => { load() }, [load])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const s = await updateSettings({ recipients, send_hour: sendHour, enabled, log_lag_hours: logLagHours }, password)
      setRecipients(s.recipients ?? [])
      setSendHour(s.send_hour ?? sendHour)
      setEnabled(!!s.enabled)
      setLogLagHours(s.log_lag_hours ?? logLagHours)
      setSaved(true)
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') clearCookie()
      else setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="job-empty">불러오는 중…</p>

  return (
    <form className="grafana-settings" onSubmit={handleSave}>
      <div className="form-field">
        <label className="form-label">수신자 이메일</label>
        <TagInput values={recipients} onChange={(v) => { setRecipients(v); setSaved(false) }} />
        <p className="form-hint">이메일 입력 후 Enter. 비우면 환경변수 수신자로 폴백됩니다. 발송을 완전히 멈추려면 아래 ‘매일 자동 발송’을 꺼주세요.</p>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="grafana-send-hour">발송 시각 (KST)</label>
        <select
          id="grafana-send-hour"
          className="form-select"
          value={sendHour}
          onChange={(e) => { setSendHour(Number(e.target.value)); setSaved(false) }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label className="grafana-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); setSaved(false) }}
          />
          매일 자동 발송
        </label>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="grafana-log-lag">로그 적재 지연 보정 (시간)</label>
        <select
          id="grafana-log-lag"
          className="form-select"
          value={logLagHours}
          onChange={(e) => { setLogLagHours(Number(e.target.value)); setSaved(false) }}
        >
          {Array.from({ length: 25 }, (_, h) => (
            <option key={h} value={h}>{h}시간</option>
          ))}
        </select>
        <p className="form-hint">로그가 ES에 늦게 색인되는 지연을 감안해, 조회 시간창을 이만큼 뒤로 당깁니다. 기본 3시간.</p>
      </div>

      {error && <div className="grafana-error">{error}</div>}
      <div className="modal-actions">
        <button type="submit" className="modal-submit" disabled={saving}>
          {saving ? '저장 중…' : saved ? '저장됨 ✓' : '저장'}
        </button>
      </div>
    </form>
  )
}
