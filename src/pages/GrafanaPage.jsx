// src/pages/GrafanaPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { getReport } from '../lib/api/grafana.js'
import { getCookie, clearCookie } from '../lib/auth.js'
import { fmtKst } from '../lib/datetime.js'
import AppHeader from '../components/shared/AppHeader.jsx'
import GrafanaSettings from '../components/grafana/GrafanaSettings.jsx'

export default function GrafanaPage() {
  const password = getCookie()
  const [tab, setTab] = useState('report')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReport(await getReport(password))
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') clearCookie()
      else setError('리포트 조회에 실패했습니다. (Grafana 연결/설정 확인)')
    } finally {
      setLoading(false)
    }
  }, [password])

  useEffect(() => { if (tab === 'report') load() }, [tab, load])

  const alerts = report?.summary?.alerts ?? 0

  return (
    <div className="app">
      <AppHeader toolName="Grafana 리포트">
        {tab === 'report' && (
          <button className="app-new-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 새로고침
          </button>
        )}
      </AppHeader>

      <nav className="nav-tabs" style={{ padding: '0 24px' }}>
        <button className={`nav-tab${tab === 'report' ? ' active' : ''}`} onClick={() => setTab('report')}>리포트</button>
        <button className={`nav-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>설정</button>
      </nav>

      <div className="grafana-wrap">
        {tab === 'settings' ? (
          <GrafanaSettings />
        ) : (
          <>
            {error && <div className="grafana-error">{error}</div>}
            {loading && !report && <p className="job-empty">조회 중…</p>}
            {report && (
              <>
                <div className={`grafana-summary ${report.summary.status}`}>
                  {alerts ? `⚠️ 이상 ${alerts}건 — 점검 필요` : '✅ 정상'}
                  <span className="grafana-time">{fmtKst(report.generatedAt)} (KST)</span>
                </div>

                <section className="grafana-section">
                  <h3 className="grafana-section-title">📈 리소스 사용량</h3>
                  <div className="grafana-cards">
                    {report.metrics.map((m) => (
                      <div key={m.label} className={`grafana-card ${m.error ? 'na' : m.over ? 'warn' : 'ok'}`}>
                        <span className="grafana-card-label">{m.label}</span>
                        <span className="grafana-card-value">
                          {m.error ? m.error : (m.value == null ? '데이터 없음' : (typeof m.value === 'number' ? m.value.toFixed(1) : m.value))}
                        </span>
                        <span className="grafana-card-threshold">임계 {m.threshold}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="grafana-section">
                  <h3 className="grafana-section-title">🔍 ERROR 로그 (앱별, 24h)</h3>
                  {report.logs.map((g) => (
                    <div key={g.app} className="grafana-log-group">
                      <div className={`grafana-log-head ${g.error ? 'na' : g.count ? 'warn' : 'ok'}`}>
                        <strong>{g.app}</strong> · {g.error ? g.error : `${g.count}건`}
                      </div>
                      {!g.error && g.count > 0 && (
                        <table className="grafana-log-table">
                          <tbody>
                            {g.rows.slice(0, 5).map((r, i) => (
                              <tr key={i}>
                                <td className="grafana-log-time">{r.time}</td>
                                <td className="grafana-log-msg">{r.msg.slice(0, 180)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
