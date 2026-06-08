# Grafana 로그 적재 지연 보정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ES 로그 조회 시간창을 `now-Δ`에서 끝나게 당겨(`[now-(24+Δ)h, now-Δ]`) 늦게 색인되는 로그 누락을 줄인다. Δ(`log_lag_hours`)는 설정에서 조절(기본 3시간), 웹 `/report`·예약 `/tick` 모두 적용.

**Architecture:** 순수함수 `esLogRange(hours, lagHours)`가 range 문자열을 만들고, `client.js`의 `queryElasticsearch`/`gatherReportData`가 lagHours를 받아 전달한다. lagHours는 `grafana_report_settings.log_lag_hours`(신규 컬럼, 기본 3)에서 오며 라우트가 읽어 넘긴다. 메트릭(Prometheus)은 실시간이라 불변.

**Tech Stack:** Node ESM, Express, Supabase, Vitest+supertest, React.

---

## 파일 구조

| 파일 | 책임 | 작업 |
|------|------|------|
| `server/grafana/report.js` | 순수 `esLogRange` 추가 | Modify |
| `server/grafana/config.js` | `LOG_INDEX_LAG_HOURS=3` 상수 | Modify |
| `server/grafana/client.js` | `queryElasticsearch`/`gatherReportData` lagHours 인자화 | Modify |
| `supabase/migrations/20260608000000_add_log_lag_hours.sql` | `log_lag_hours` 컬럼 ALTER | Create |
| `server/grafana/settings.js` | `saveSettings`에 `log_lag_hours` 포함 | Modify |
| `server/routes/grafana.js` | GET/PUT `/settings`·`/report`·`/tick`에 lag 적용 | Modify |
| `server/routes/grafana.test.js` | 테스트 확장 | Modify |
| `src/components/grafana/GrafanaSettings.jsx` | "로그 적재 지연 보정" 필드 | Modify |

---

## Task 1: esLogRange 순수 함수 (TDD)

**Files:** Modify `server/grafana/report.js`, Test `server/grafana/report.test.js`

- [ ] **Step 1: 테스트 추가 (실패 먼저)**

`server/grafana/report.test.js` 상단 import에서 `buildEmailHtml` 뒤에 `esLogRange`를 추가한다. 현재:
```javascript
import {
  extractPromValue, normalizeEsIndex, fmtTimeKst, parseEsResponses, buildReport, buildEmailHtml,
} from './report.js'
```
로 →
```javascript
import {
  extractPromValue, normalizeEsIndex, fmtTimeKst, parseEsResponses, buildReport, buildEmailHtml, esLogRange,
} from './report.js'
```
그리고 파일 끝에 describe 블록 추가:
```javascript
describe('esLogRange', () => {
  it('lagHours=0이면 now-24h ~ now', () => {
    expect(esLogRange(24, 0)).toEqual({ gte: 'now-24h', lte: 'now' })
  })
  it('lagHours=3이면 now-27h ~ now-3h', () => {
    expect(esLogRange(24, 3)).toEqual({ gte: 'now-27h', lte: 'now-3h' })
  })
  it('lagHours 기본값은 0', () => {
    expect(esLogRange(24)).toEqual({ gte: 'now-24h', lte: 'now' })
  })
  it('lagHours=24면 now-48h ~ now-24h', () => {
    expect(esLogRange(24, 24)).toEqual({ gte: 'now-48h', lte: 'now-24h' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/grafana/report.test.js`
Expected: FAIL — `esLogRange` is not exported / not a function.

- [ ] **Step 3: 구현** — `server/grafana/report.js`의 `fmtTimeKst` 함수 바로 아래(또는 `parseEsResponses` 위)에 추가:

```javascript
// ES 로그 조회 시간창. 적재 지연(lagHours) 보정을 위해 now-lagHours에서 끝나는 hours 길이 창.
export function esLogRange(hours, lagHours = 0) {
  return {
    gte: `now-${hours + lagHours}h`,
    lte: lagHours > 0 ? `now-${lagHours}h` : 'now',
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run server/grafana/report.test.js`
Expected: PASS (esLogRange 4개 포함).

- [ ] **Step 5: 커밋**
```bash
git add server/grafana/report.js server/grafana/report.test.js
git commit -m "feat(grafana): add esLogRange pure helper for lag-offset window"
```
커밋 메시지 끝에 빈 줄 후 트레일러:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 2: config 상수 + client.js 배선

**Files:** Modify `server/grafana/config.js`, `server/grafana/client.js`

- [ ] **Step 1: config 상수 추가** — `server/grafana/config.js` 끝의 `export const LOG_SHOW = 5` 아래에 추가:

```javascript

// 로그 적재 지연 보정 기본값(시간). 설정(log_lag_hours)이 없을 때의 폴백.
export const LOG_INDEX_LAG_HOURS = 3
```

- [ ] **Step 2: client.js 수정**

(a) import에 `LOG_INDEX_LAG_HOURS`와 `esLogRange` 추가. 현재:
```javascript
import { METRICS, LOG_QUERIES, LOG_HOURS, LOG_FETCH } from './config.js'
import { extractPromValue, normalizeEsIndex, parseEsResponses } from './report.js'
```
→
```javascript
import { METRICS, LOG_QUERIES, LOG_HOURS, LOG_FETCH, LOG_INDEX_LAG_HOURS } from './config.js'
import { extractPromValue, normalizeEsIndex, parseEsResponses, esLogRange } from './report.js'
```

(b) `queryElasticsearch` 시그니처와 range. 현재:
```javascript
export async function queryElasticsearch(queries, hours, fetchSize) {
  const { url } = cfg()
  const uid = process.env.ES_UID
  const { index, timefield } = await getEsIndexAndTimeField(uid)
  const nd = []
  for (const lq of queries) {
    nd.push(JSON.stringify({ index, ignore_unavailable: true }))
    nd.push(JSON.stringify({
      size: fetchSize,
      track_total_hits: true,
      sort: [{ [timefield]: { order: 'desc' } }],
      query: { bool: {
        must: [{ query_string: { query: lq.query } }],
        filter: [{ range: { [timefield]: { gte: `now-${hours}h`, lte: 'now' } } }],
      } },
    }))
  }
```
→
```javascript
export async function queryElasticsearch(queries, hours, fetchSize, lagHours = 0) {
  const { url } = cfg()
  const uid = process.env.ES_UID
  const { index, timefield } = await getEsIndexAndTimeField(uid)
  const range = esLogRange(hours, lagHours)
  const nd = []
  for (const lq of queries) {
    nd.push(JSON.stringify({ index, ignore_unavailable: true }))
    nd.push(JSON.stringify({
      size: fetchSize,
      track_total_hits: true,
      sort: [{ [timefield]: { order: 'desc' } }],
      query: { bool: {
        must: [{ query_string: { query: lq.query } }],
        filter: [{ range: { [timefield]: range } }],
      } },
    }))
  }
```

(c) `gatherReportData` 시그니처와 ES 호출. 현재:
```javascript
export async function gatherReportData() {
```
→
```javascript
export async function gatherReportData(lagHours = LOG_INDEX_LAG_HOURS) {
```
그리고 같은 함수 안:
```javascript
    const res = await queryElasticsearch(LOG_QUERIES, LOG_HOURS, LOG_FETCH)
```
→
```javascript
    const res = await queryElasticsearch(LOG_QUERIES, LOG_HOURS, LOG_FETCH, lagHours)
```

- [ ] **Step 3: lint**

Run: `npx eslint server/grafana/config.js server/grafana/client.js`
Expected: clean.

- [ ] **Step 4: 커밋**
```bash
git add server/grafana/config.js server/grafana/client.js
git commit -m "feat(grafana): thread lagHours through queryElasticsearch/gatherReportData"
```
트레일러:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 3: 마이그레이션 (log_lag_hours 컬럼)

**Files:** Create `supabase/migrations/20260608000000_add_log_lag_hours.sql`

- [ ] **Step 1: 파일 작성** (정확히):
```sql
-- grafana_report_settings에 로그 적재 지연 보정(시간) 컬럼 추가. 기본 3, 기존 행은 자동 3 백필.
ALTER TABLE grafana_report_settings
  ADD COLUMN IF NOT EXISTS log_lag_hours SMALLINT NOT NULL DEFAULT 3
  CHECK (log_lag_hours BETWEEN 0 AND 24);
```

- [ ] **Step 2: 커밋** (DB 적용은 배포 단계 — 여기선 파일만)
```bash
git add supabase/migrations/20260608000000_add_log_lag_hours.sql
git commit -m "feat(grafana): migration for log_lag_hours setting column"
```
트레일러:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

> 적용은 Supabase 대시보드 SQL Editor에서 실행. **`supabase db push` 금지**(마이그레이션 이력 divergence).

---

## Task 4: settings.js — saveSettings에 log_lag_hours 포함

**Files:** Modify `server/grafana/settings.js`

- [ ] **Step 1: 수정** — `saveSettings` 함수. 현재:
```javascript
export async function saveSettings({ recipients, send_hour, enabled }) {
  const { data, error } = await db
    .from(TABLE)
    .update({ recipients, send_hour, enabled, updated_at: new Date().toISOString() })
    .eq('id', SINGLETON_ID)
    .select('*')
    .single()
  if (error) throw error
  return data
}
```
→
```javascript
export async function saveSettings({ recipients, send_hour, enabled, log_lag_hours }) {
  const { data, error } = await db
    .from(TABLE)
    .update({ recipients, send_hour, enabled, log_lag_hours, updated_at: new Date().toISOString() })
    .eq('id', SINGLETON_ID)
    .select('*')
    .single()
  if (error) throw error
  return data
}
```

- [ ] **Step 2: lint**

Run: `npx eslint server/grafana/settings.js`
Expected: clean.

- [ ] **Step 3: 커밋**
```bash
git add server/grafana/settings.js
git commit -m "feat(grafana): persist log_lag_hours in saveSettings"
```
트레일러:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 5: 라우터 — settings/report/tick에 lag 적용 (TDD)

**Files:** Modify `server/routes/grafana.js`, `server/routes/grafana.test.js`

- [ ] **Step 1: 테스트 전체 교체** — `server/routes/grafana.test.js`를 아래로 교체:

```javascript
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/routes/grafana.test.js`
Expected: FAIL — 라우터가 아직 log_lag_hours/lag 미적용(예: `gatherReportData` 인자 없음, PUT saveSettings에 log_lag_hours 없음).

- [ ] **Step 3: 라우터 전체 교체** — `server/routes/grafana.js`를 아래로 교체:

```javascript
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
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run server/routes/grafana.test.js`
Expected: PASS (전부).

- [ ] **Step 5: 전체 테스트 + lint**

Run: `npm test`  → 전체 PASS.
Run: `npm run lint` → clean.

- [ ] **Step 6: 커밋**
```bash
git add server/routes/grafana.js server/routes/grafana.test.js
git commit -m "feat(grafana): apply configurable log_lag_hours offset in settings/report/tick"
```
트레일러:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 6: GrafanaSettings UI 필드

**Files:** Modify `src/components/grafana/GrafanaSettings.jsx`

- [ ] **Step 1: 상태 추가** — `const [enabled, setEnabled] = useState(true)` 아래에 추가:
```javascript
  const [logLagHours, setLogLagHours] = useState(3)
```

- [ ] **Step 2: load에서 초기화** — `load`의 `setEnabled(!!s.enabled)` 아래에 추가:
```javascript
      setLogLagHours(s.log_lag_hours ?? 3)
```

- [ ] **Step 3: handleSave 반영** — `updateSettings` 호출과 그 직후 동기화를 수정. 현재:
```javascript
      const s = await updateSettings({ recipients, send_hour: sendHour, enabled }, password)
      setRecipients(s.recipients ?? [])
      setSendHour(s.send_hour ?? sendHour)
      setEnabled(!!s.enabled)
      setSaved(true)
```
→
```javascript
      const s = await updateSettings({ recipients, send_hour: sendHour, enabled, log_lag_hours: logLagHours }, password)
      setRecipients(s.recipients ?? [])
      setSendHour(s.send_hour ?? sendHour)
      setEnabled(!!s.enabled)
      setLogLagHours(s.log_lag_hours ?? logLagHours)
      setSaved(true)
```

- [ ] **Step 4: UI 필드 추가** — "매일 자동 발송" 토글 `form-field` div 바로 뒤(`{error && ...}` 앞)에 추가:
```javascript
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
```

- [ ] **Step 5: lint + build**

Run: `npx eslint src/components/grafana/GrafanaSettings.jsx` → clean.
Run: `npm run build` → 성공.

- [ ] **Step 6: 커밋**
```bash
git add src/components/grafana/GrafanaSettings.jsx
git commit -m "feat(grafana): add log lag offset field to settings form"
```
트레일러:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Task 7: 전체 검증

- [ ] **Step 1:** `npm test && npm run lint && npm run build`
Expected: 전체 PASS (report.test.js esLogRange 4 + routes settings/tick 확장 포함), lint clean, build 성공.

- [ ] **Step 2: (선택) 로컬 dev 확인** — `.env`에 `grafana_report_settings` 미적용 상태면 `/report`는 폴백 3으로 동작. 마이그레이션 적용 후 설정 탭에서 "로그 적재 지연 보정" 저장/유지 확인.

---

## 배포 (사용자 명시 승인 필요)

- [ ] D1. push: `git push origin main`
- [ ] D2. 배포: `npx vercel --prod`
- [ ] D3. 마이그레이션: Supabase 대시보드 SQL Editor에서 Task 3 ALTER 실행(멱등). **`db push` 금지.**
- [ ] D4. 검증: `/api/grafana/settings`에 `log_lag_hours:3` 응답, 설정 탭에서 값 변경 저장.

---

## Self-Review

- **Spec coverage**: §2 메커니즘(esLogRange Task1, client 배선 Task2), §3 설정값(config Task2, 마이그레이션 Task3), §4 적용범위(routes /report·/tick Task5, 메트릭 불변), §5 인터페이스(전 Task), §6 /report getSettings 폴백(Task5 lagFrom+try), §7 테스트(Task1·Task5) → 전부 커버. ✅
- **Placeholder scan**: 모든 단계 실제 코드/명령. TBD 없음. ✅
- **Type/이름 일관성**: `esLogRange(hours, lagHours)` → `{gte,lte}` (Task1 정의, Task2 사용). `gatherReportData(lagHours)`/`queryElasticsearch(...,lagHours)` (Task2). `saveSettings({...,log_lag_hours})` (Task4, Task5 호출, Task5 테스트 단언 일치). `lagFrom(settings)`→`log_lag_hours` 0~24 (Task5). 컬럼명 `log_lag_hours` 전 구간 일치. ✅
