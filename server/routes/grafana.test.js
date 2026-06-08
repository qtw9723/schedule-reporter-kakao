// server/routes/grafana.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../grafana/client.js', () => ({ gatherReportData: vi.fn() }))
vi.mock('../grafana/email.js', () => ({ sendReportEmail: vi.fn() }))
vi.mock('../grafana/settings.js', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  markSent: vi.fn(),
}))

import { gatherReportData } from '../grafana/client.js'
import { sendReportEmail } from '../grafana/email.js'
import { getSettings, saveSettings, markSent } from '../grafana/settings.js'
const { default: grafanaRouter } = await import('./grafana.js')

const app = express()
app.use(express.json())
app.use('/api/grafana', grafanaRouter)

const SAMPLE = {
  metrics: [{ label: 'CPU', value: 10, threshold: 80, error: null }],
  logs: [{ app: 'soe', count: 0, rows: [], error: null }],
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_PASSWORD = 'test-pw'
  process.env.CRON_SECRET = 'cron-secret'
  process.env.GRAFANA_EMAIL_TO = 'fallback@example.com'
})

describe('GET /api/grafana/report', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).get('/api/grafana/report')
    expect(res.status).toBe(401)
  })
  it('인증 성공 시 리포트 JSON 반환', async () => {
    gatherReportData.mockResolvedValueOnce(SAMPLE)
    const res = await request(app).get('/api/grafana/report').set('x-app-password', 'test-pw')
    expect(res.status).toBe(200)
    expect(res.body.summary).toEqual({ alerts: 0, status: 'ok' })
  })
  it('Grafana 조회 실패 시 502', async () => {
    gatherReportData.mockRejectedValueOnce(new Error('grafana down'))
    const res = await request(app).get('/api/grafana/report').set('x-app-password', 'test-pw')
    expect(res.status).toBe(502)
  })
  it('설정의 log_lag_hours로 gatherReportData 호출', async () => {
    getSettings.mockResolvedValueOnce({ recipients: ['a@x.com'], send_hour: 9, enabled: true, log_lag_hours: 2 })
    gatherReportData.mockResolvedValueOnce(SAMPLE)
    await request(app).get('/api/grafana/report').set('x-app-password', 'test-pw')
    expect(gatherReportData).toHaveBeenCalledWith(2)
  })
  it('설정 조회 실패해도 기본 오프셋(3)으로 리포트 반환', async () => {
    getSettings.mockRejectedValueOnce(new Error('db down'))
    gatherReportData.mockResolvedValueOnce(SAMPLE)
    const res = await request(app).get('/api/grafana/report').set('x-app-password', 'test-pw')
    expect(res.status).toBe(200)
    expect(gatherReportData).toHaveBeenCalledWith(3)
  })
})

describe('GET /api/grafana/settings', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).get('/api/grafana/settings')
    expect(res.status).toBe(401)
  })
  it('recipients 비어있으면 env 폴백으로 채워 반환', async () => {
    getSettings.mockResolvedValueOnce({ id: 1, recipients: [], send_hour: 9, enabled: true, last_sent_date: null, log_lag_hours: 3 })
    const res = await request(app).get('/api/grafana/settings').set('x-app-password', 'test-pw')
    expect(res.status).toBe(200)
    expect(res.body.recipients).toEqual(['fallback@example.com'])
    expect(res.body.send_hour).toBe(9)
    expect(res.body.log_lag_hours).toBe(3)
  })
  it('recipients/log_lag_hours 그대로 반환', async () => {
    getSettings.mockResolvedValueOnce({ id: 1, recipients: ['a@x.com'], send_hour: 13, enabled: false, last_sent_date: null, log_lag_hours: 5 })
    const res = await request(app).get('/api/grafana/settings').set('x-app-password', 'test-pw')
    expect(res.body.recipients).toEqual(['a@x.com'])
    expect(res.body.log_lag_hours).toBe(5)
  })
})

describe('PUT /api/grafana/settings', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).put('/api/grafana/settings').send({ recipients: [], send_hour: 9, enabled: true })
    expect(res.status).toBe(401)
  })
  it('send_hour 범위 밖이면 400', async () => {
    const res = await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com'], send_hour: 24, enabled: true })
    expect(res.status).toBe(400)
  })
  it('send_hour가 숫자가 아니면 400', async () => {
    const res = await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com'], send_hour: null, enabled: true })
    expect(res.status).toBe(400)
  })
  it('log_lag_hours 범위 밖이면 400', async () => {
    const res = await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com'], send_hour: 9, enabled: true, log_lag_hours: 25 })
    expect(res.status).toBe(400)
  })
  it('log_lag_hours 음수면 400', async () => {
    const res = await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com'], send_hour: 9, enabled: true, log_lag_hours: -1 })
    expect(res.status).toBe(400)
  })
  it('정상 저장 시 log_lag_hours 포함해 저장(미지정 시 기본 3)', async () => {
    saveSettings.mockResolvedValueOnce({ id: 1, recipients: ['a@x.com'], send_hour: 8, enabled: true, last_sent_date: null, log_lag_hours: 3 })
    const res = await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com', ' '], send_hour: 8, enabled: true })
    expect(res.status).toBe(200)
    expect(saveSettings).toHaveBeenCalledWith({ recipients: ['a@x.com'], send_hour: 8, enabled: true, log_lag_hours: 3 })
  })
  it('log_lag_hours 지정 시 그 값으로 저장', async () => {
    saveSettings.mockResolvedValueOnce({ id: 1, recipients: ['a@x.com'], send_hour: 8, enabled: true, last_sent_date: null, log_lag_hours: 2 })
    await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com'], send_hour: 8, enabled: true, log_lag_hours: 2 })
    expect(saveSettings).toHaveBeenCalledWith({ recipients: ['a@x.com'], send_hour: 8, enabled: true, log_lag_hours: 2 })
  })
})

describe('GET /api/grafana/tick', () => {
  it('CRON_SECRET 없으면 401', async () => {
    const res = await request(app).get('/api/grafana/tick')
    expect(res.status).toBe(401)
  })
  it('비활성 시 발송 안 하고 skip', async () => {
    getSettings.mockResolvedValueOnce({ recipients: ['a@x.com'], send_hour: 9, enabled: false, last_sent_date: null })
    const res = await request(app).get('/api/grafana/tick').set('Authorization', 'Bearer cron-secret')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: false, reason: 'disabled' })
    expect(sendReportEmail).not.toHaveBeenCalled()
  })
  it('시각 불일치 시 skip', async () => {
    getSettings.mockResolvedValueOnce({ recipients: ['a@x.com'], send_hour: 99, enabled: true, last_sent_date: null })
    const res = await request(app).get('/api/grafana/tick').set('Authorization', 'Bearer cron-secret')
    expect(res.body.sent).toBe(false)
    expect(res.body.reason).toBe('not-time')
  })
  it('발송 조건 충족 시 설정 recipients/lag로 발송 후 markSent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-05T00:00:00Z'))
    try {
      getSettings.mockResolvedValueOnce({ recipients: ['a@x.com'], send_hour: 9, enabled: true, last_sent_date: '2000-01-01', log_lag_hours: 4 })
      gatherReportData.mockResolvedValueOnce(SAMPLE)
      sendReportEmail.mockResolvedValueOnce()
      const res = await request(app).get('/api/grafana/tick').set('Authorization', 'Bearer cron-secret')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ sent: true, alerts: 0 })
      expect(gatherReportData).toHaveBeenCalledWith(4)
      expect(sendReportEmail).toHaveBeenCalledOnce()
      expect(sendReportEmail.mock.calls[0][1]).toEqual(['a@x.com'])
      expect(markSent).toHaveBeenCalledOnce()
      expect(markSent.mock.calls[0][0]).toBe('2026-06-05')
    } finally {
      vi.useRealTimers()
    }
  })
  it('recipients 없고 env 폴백도 없으면 no-recipients', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-05T00:00:00Z'))
    process.env.GRAFANA_EMAIL_TO = ''
    try {
      getSettings.mockResolvedValueOnce({ recipients: [], send_hour: 9, enabled: true, last_sent_date: '2000-01-01' })
      const res = await request(app).get('/api/grafana/tick').set('Authorization', 'Bearer cron-secret')
      expect(res.body).toEqual({ sent: false, reason: 'no-recipients' })
      expect(sendReportEmail).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
