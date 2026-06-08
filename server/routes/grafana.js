// server/routes/grafana.js
import { Router } from 'express'
import { gatherReportData } from '../grafana/client.js'
import { buildReport, buildEmailHtml } from '../grafana/report.js'
import { sendReportEmail } from '../grafana/email.js'
import { getSettings, saveSettings, markSent } from '../grafana/settings.js'
import { shouldSend, kstDateString } from '../grafana/schedule.js'
import { LOG_INDEX_LAG_HOURS } from '../grafana/config.js'

const router = Router()

function auth(req, res, next) {
  if (req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

function envRecipients() {
  return (process.env.GRAFANA_EMAIL_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

// 설정의 log_lag_hours(0~24 정수)만 채택, 그 외엔 기본 상수로 폴백
function lagFrom(settings) {
  const v = settings?.log_lag_hours
  return Number.isInteger(v) && v >= 0 && v <= 24 ? v : LOG_INDEX_LAG_HOURS
}

// GET /api/grafana/report — 웹 on-demand 조회 (설정 오프셋 적용)
router.get('/report', auth, async (_req, res) => {
  let lagHours = LOG_INDEX_LAG_HOURS
  try { lagHours = lagFrom(await getSettings()) } catch { /* 설정 조회 실패 시 기본 오프셋 */ }
  try {
    const report = buildReport(await gatherReportData(lagHours))
    res.json(report)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/grafana/settings
router.get('/settings', auth, async (_req, res) => {
  try {
    const s = await getSettings()
    const recipients = s.recipients?.length ? s.recipients : envRecipients()
    res.json({ ...s, recipients })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/grafana/settings
router.put('/settings', auth, async (req, res) => {
  const { recipients, send_hour, enabled } = req.body
  if (typeof send_hour !== 'number' || !Number.isInteger(send_hour) || send_hour < 0 || send_hour > 23) {
    return res.status(400).json({ error: 'send_hour must be an integer 0-23' })
  }
  const log_lag_hours = req.body.log_lag_hours ?? LOG_INDEX_LAG_HOURS
  if (typeof log_lag_hours !== 'number' || !Number.isInteger(log_lag_hours) || log_lag_hours < 0 || log_lag_hours > 24) {
    return res.status(400).json({ error: 'log_lag_hours must be an integer 0-24' })
  }
  const cleanRecipients = Array.isArray(recipients)
    ? recipients.map((s) => String(s).trim()).filter(Boolean)
    : []
  try {
    const saved = await saveSettings({ recipients: cleanRecipients, send_hour, enabled: !!enabled, log_lag_hours })
    res.json(saved)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/grafana/tick — Supabase pg_cron이 매시간 호출. 설정대로 발송.
// (pg_net의 http_get은 GET만 지원하므로 상태 변경이지만 GET을 사용)
router.get('/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const now = new Date()
    const settings = await getSettings()
    const decision = shouldSend(settings, now)
    if (!decision.send) return res.json({ sent: false, reason: decision.reason })

    const recipients = settings.recipients?.length ? settings.recipients : envRecipients()
    if (recipients.length === 0) return res.json({ sent: false, reason: 'no-recipients' })

    const report = buildReport(await gatherReportData(lagFrom(settings)))
    await sendReportEmail(buildEmailHtml(report), recipients)
    await markSent(kstDateString(now))
    res.json({ sent: true, alerts: report.summary.alerts })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
