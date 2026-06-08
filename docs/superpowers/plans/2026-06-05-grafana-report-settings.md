# Grafana 리포트 발송 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grafana 일일 리포트의 수신자와 발송 시각(시 단위)을 `/grafana` "설정" 탭에서 편집·저장하고, Supabase pg_cron이 매시간 트리거하는 `/api/grafana/tick`이 그 설정대로 발송하도록 한다.

**Architecture:** 설정은 Supabase 싱글톤 테이블 `grafana_report_settings`에 저장. 스케줄 판단 로직은 순수 함수 `server/grafana/schedule.js`로 분리해 단위테스트. `/api/grafana/tick`(CRON_SECRET 인증)이 매시간 호출되어 `shouldSend` 판단 후 설정 recipients로 발송하고 `last_sent_date`로 중복을 막는다. 기존 Vercel cron(`/cron`)은 제거하고 pg_cron으로 일원화. 프런트는 메일러의 탭+폼(TagInput) 패턴을 재사용.

**Tech Stack:** Node/Express, Supabase JS, Vitest+supertest, React, Vite. Supabase pg_cron + pg_net.

---

## 파일 구조

| 파일 | 책임 | 작업 |
|------|------|------|
| `supabase/migrations/20260605000000_add_grafana_report_settings.sql` | 설정 테이블 + 싱글톤 시드 | Create |
| `server/grafana/schedule.js` | KST 시각 계산 + `shouldSend` 순수 함수 | Create |
| `server/grafana/schedule.test.js` | 위 순수 함수 단위테스트 | Create |
| `server/grafana/settings.js` | 설정 조회/생성/저장/마지막발송갱신 (Supabase 접근) | Create |
| `server/grafana/email.js` | `sendReportEmail(html, recipients)` 수신자 인자화 | Modify |
| `server/routes/grafana.js` | `/settings` GET·PUT, `/cron`→`/tick` 교체 | Modify |
| `server/routes/grafana.test.js` | settings·tick 분기 테스트 확장 | Modify |
| `src/lib/api/grafana.js` | `getSettings`/`updateSettings` 추가 | Modify |
| `src/components/grafana/GrafanaSettings.jsx` | 설정 폼(수신자/시각/토글) | Create |
| `src/pages/GrafanaPage.jsx` | 탭(리포트/설정) 추가 | Modify |
| `src/index.css` | 설정 폼 최소 스타일 | Modify |
| `vercel.json` | `/api/grafana/cron` cron 항목 제거 | Modify |

> 마이그레이션 적용: Supabase 대시보드 SQL 에디터에 붙여넣어 실행(프로젝트 ref `enawzdqroidrhtjqhpka`). 로컬 테스트는 Supabase 접근을 모킹하므로 DB 없이도 통과.

---

## Task 1: 스케줄 판단 순수 함수

**Files:**
- Create: `server/grafana/schedule.js`
- Test: `server/grafana/schedule.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// server/grafana/schedule.test.js
import { describe, it, expect } from 'vitest'
import { kstHour, kstDateString, shouldSend } from './schedule.js'

describe('kstHour', () => {
  it('UTC 00:00 → KST 9시', () => {
    expect(kstHour(new Date('2026-06-05T00:00:00Z'))).toBe(9)
  })
  it('UTC 15:30 → KST 0시(다음날)', () => {
    expect(kstHour(new Date('2026-06-05T15:30:00Z'))).toBe(0)
  })
})

describe('kstDateString', () => {
  it('UTC 23:00 → KST 다음날 날짜', () => {
    expect(kstDateString(new Date('2026-06-05T23:00:00Z'))).toBe('2026-06-06')
  })
  it('UTC 00:00 → 같은 날 KST 09시', () => {
    expect(kstDateString(new Date('2026-06-05T00:00:00Z'))).toBe('2026-06-05')
  })
})

describe('shouldSend', () => {
  const now = new Date('2026-06-05T00:00:00Z') // KST 9시, 날짜 2026-06-05
  it('enabled=false면 disabled', () => {
    expect(shouldSend({ enabled: false, send_hour: 9, last_sent_date: null }, now))
      .toEqual({ send: false, reason: 'disabled' })
  })
  it('시각 불일치면 not-time', () => {
    expect(shouldSend({ enabled: true, send_hour: 10, last_sent_date: null }, now))
      .toEqual({ send: false, reason: 'not-time' })
  })
  it('오늘 이미 보냈으면 already-sent', () => {
    expect(shouldSend({ enabled: true, send_hour: 9, last_sent_date: '2026-06-05' }, now))
      .toEqual({ send: false, reason: 'already-sent' })
  })
  it('조건 충족 시 ok', () => {
    expect(shouldSend({ enabled: true, send_hour: 9, last_sent_date: '2026-06-04' }, now))
      .toEqual({ send: true, reason: 'ok' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/grafana/schedule.test.js`
Expected: FAIL — `schedule.js` 없음 / export 미정의.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/grafana/schedule.js
// KST = UTC+9, DST 없음. UTC Date에 9시간 더해 KST 시계값을 구한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function toKst(date) {
  return new Date(date.getTime() + KST_OFFSET_MS)
}

export function kstHour(date) {
  return toKst(date).getUTCHours()
}

export function kstDateString(date) {
  return toKst(date).toISOString().slice(0, 10)
}

export function shouldSend(settings, now) {
  if (!settings.enabled) return { send: false, reason: 'disabled' }
  if (kstHour(now) !== settings.send_hour) return { send: false, reason: 'not-time' }
  if (settings.last_sent_date === kstDateString(now)) return { send: false, reason: 'already-sent' }
  return { send: true, reason: 'ok' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/grafana/schedule.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/grafana/schedule.js server/grafana/schedule.test.js
git commit -m "feat(grafana): add pure schedule decision functions (KST hour, shouldSend)"
```

---

## Task 2: 설정 DB 접근 모듈

**Files:**
- Create: `server/grafana/settings.js`

> Supabase 호출 모듈. 라우터 테스트에서 이 모듈을 통째로 모킹하므로 자체 단위테스트는 두지 않는다(메일러의 `db.js`와 동일 정책). 라우터 테스트(Task 5)가 사용처를 커버.

- [ ] **Step 1: Write implementation**

```javascript
// server/grafana/settings.js
import db from '../db.js'

const TABLE = 'grafana_report_settings'
const SINGLETON_ID = 1

// 싱글톤 행 조회. 없으면 기본값으로 생성 후 반환.
export async function getSettings() {
  const { data, error } = await db.from(TABLE).select('*').eq('id', SINGLETON_ID).maybeSingle()
  if (error) throw error
  if (data) return data

  const { data: created, error: insErr } = await db
    .from(TABLE)
    .insert({ id: SINGLETON_ID })
    .select('*')
    .single()
  if (insErr) throw insErr
  return created
}

// recipients/send_hour/enabled 저장.
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

// 발송 성공 후 마지막 발송 날짜 기록.
export async function markSent(dateStr) {
  const { error } = await db
    .from(TABLE)
    .update({ last_sent_date: dateStr })
    .eq('id', SINGLETON_ID)
  if (error) throw error
}
```

- [ ] **Step 2: Lint check**

Run: `npx eslint server/grafana/settings.js`
Expected: 통과(에러 없음).

- [ ] **Step 3: Commit**

```bash
git add server/grafana/settings.js
git commit -m "feat(grafana): add settings db access module (singleton get/save/markSent)"
```

---

## Task 3: email.js 수신자 인자화

**Files:**
- Modify: `server/grafana/email.js`

- [ ] **Step 1: Replace file contents**

기존 `sendReportEmail(html)`는 env에서 `to`를 읽었다. 수신자를 인자로 받도록 바꾸고 env 파싱 책임은 라우터로 옮긴다.

```javascript
// server/grafana/email.js
import nodemailer from 'nodemailer'

export async function sendReportEmail(html, recipients) {
  const from = process.env.GRAFANA_EMAIL_FROM
  const pass = process.env.GRAFANA_EMAIL_PASSWORD
  if (!from || !pass) throw new Error('GRAFANA_EMAIL_FROM/PASSWORD 미설정')

  const to = (recipients ?? []).map((s) => String(s).trim()).filter(Boolean)
  if (to.length === 0) throw new Error('수신자가 없습니다')

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: from, pass },
  })
  await transporter.sendMail({
    from,
    to,
    subject: '[Next-TI 운영] 그라파나 모니터링 보고서',
    html,
  })
}
```

- [ ] **Step 2: Run existing tests + lint**

Run: `npx vitest run server/routes/grafana.test.js`
Expected: PASS. 기존 `/cron` 테스트는 `sendReportEmail`을 모킹하므로 인자 수가 바뀌어도 영향 없음(라우터의 1-인자 호출도 모킹된 함수라 통과). 실제 라우터의 2-인자 전환은 Task 5에서 처리.

Run: `npx eslint server/grafana/email.js`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add server/grafana/email.js
git commit -m "feat(grafana): parameterize sendReportEmail recipients"
```

---

## Task 4: 마이그레이션 (설정 테이블)

**Files:**
- Create: `supabase/migrations/20260605000000_add_grafana_report_settings.sql`

- [ ] **Step 1: Write migration**

```sql
-- grafana_report_settings: 일일 리포트 발송 설정 (싱글톤)
CREATE TABLE IF NOT EXISTS grafana_report_settings (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  recipients     TEXT[]      NOT NULL DEFAULT '{}',
  send_hour      SMALLINT    NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  last_sent_date DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO grafana_report_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Apply migration**

Supabase 대시보드(프로젝트 `enawzdqroidrhtjqhpka`) → SQL Editor에 위 SQL 붙여넣고 실행. 또는 supabase CLI 연결돼 있으면 `npx supabase db push`.
Expected: 테이블 생성, 싱글톤 행 1개.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605000000_add_grafana_report_settings.sql
git commit -m "feat(grafana): add grafana_report_settings table migration"
```

---

## Task 5: 라우터 — /settings GET·PUT, /cron→/tick 교체

**Files:**
- Modify: `server/routes/grafana.js`
- Modify: `server/routes/grafana.test.js`

- [ ] **Step 1: Write failing tests**

`server/routes/grafana.test.js`를 아래로 **교체**한다. (기존 `/cron` describe 블록 제거, settings·tick 추가. report 블록은 유지.)

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
})

describe('GET /api/grafana/settings', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).get('/api/grafana/settings')
    expect(res.status).toBe(401)
  })
  it('recipients 비어있으면 env 폴백으로 채워 반환', async () => {
    getSettings.mockResolvedValueOnce({ id: 1, recipients: [], send_hour: 9, enabled: true, last_sent_date: null })
    const res = await request(app).get('/api/grafana/settings').set('x-app-password', 'test-pw')
    expect(res.status).toBe(200)
    expect(res.body.recipients).toEqual(['fallback@example.com'])
    expect(res.body.send_hour).toBe(9)
  })
  it('recipients 있으면 그대로 반환', async () => {
    getSettings.mockResolvedValueOnce({ id: 1, recipients: ['a@x.com'], send_hour: 13, enabled: false, last_sent_date: null })
    const res = await request(app).get('/api/grafana/settings').set('x-app-password', 'test-pw')
    expect(res.body.recipients).toEqual(['a@x.com'])
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
  it('정상 저장 시 저장된 설정 반환', async () => {
    saveSettings.mockResolvedValueOnce({ id: 1, recipients: ['a@x.com'], send_hour: 8, enabled: true, last_sent_date: null })
    const res = await request(app).put('/api/grafana/settings')
      .set('x-app-password', 'test-pw').send({ recipients: ['a@x.com', ' '], send_hour: 8, enabled: true })
    expect(res.status).toBe(200)
    // 공백 항목 제거되어 저장 호출됨
    expect(saveSettings).toHaveBeenCalledWith({ recipients: ['a@x.com'], send_hour: 8, enabled: true })
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
    // 현재 KST 시와 다른 값을 강제하기 위해 send_hour를 의도적으로 -1 불가값 대신 현재시각 회피값 사용:
    // shouldSend가 not-time을 반환하도록, send_hour를 현재 KST 시각과 다르게 설정.
    getSettings.mockResolvedValueOnce({ recipients: ['a@x.com'], send_hour: 99, enabled: true, last_sent_date: null })
    const res = await request(app).get('/api/grafana/tick').set('Authorization', 'Bearer cron-secret')
    expect(res.body.sent).toBe(false)
    expect(res.body.reason).toBe('not-time')
  })
  it('발송 조건 충족 시 설정 recipients로 발송 후 markSent', async () => {
    // 현재 KST 시각을 그대로 send_hour로 넣어 ok가 되게 함
    const { kstHour } = await import('../grafana/schedule.js')
    const hourNow = kstHour(new Date())
    getSettings.mockResolvedValueOnce({ recipients: ['a@x.com'], send_hour: hourNow, enabled: true, last_sent_date: '2000-01-01' })
    gatherReportData.mockResolvedValueOnce(SAMPLE)
    sendReportEmail.mockResolvedValueOnce()
    const res = await request(app).get('/api/grafana/tick').set('Authorization', 'Bearer cron-secret')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: true, alerts: 0 })
    expect(sendReportEmail).toHaveBeenCalledOnce()
    expect(sendReportEmail.mock.calls[0][1]).toEqual(['a@x.com'])
    expect(markSent).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/routes/grafana.test.js`
Expected: FAIL — `/settings`, `/tick` 라우트 미구현, settings 모듈 import 없음.

- [ ] **Step 3: Rewrite `server/routes/grafana.js`**

```javascript
// server/routes/grafana.js
import { Router } from 'express'
import { gatherReportData } from '../grafana/client.js'
import { buildReport, buildEmailHtml } from '../grafana/report.js'
import { sendReportEmail } from '../grafana/email.js'
import { getSettings, saveSettings, markSent } from '../grafana/settings.js'
import { shouldSend, kstDateString } from '../grafana/schedule.js'

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

// GET /api/grafana/report — 웹 on-demand 조회
router.get('/report', auth, async (_req, res) => {
  try {
    const report = buildReport(await gatherReportData())
    res.json(report)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// GET /api/grafana/settings — 현재 설정 조회 (recipients 비면 env 폴백)
router.get('/settings', auth, async (_req, res) => {
  try {
    const s = await getSettings()
    const recipients = s.recipients?.length ? s.recipients : envRecipients()
    res.json({ ...s, recipients })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/grafana/settings — 설정 저장
router.put('/settings', auth, async (req, res) => {
  const { recipients, send_hour, enabled } = req.body
  const hour = Number(send_hour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return res.status(400).json({ error: 'send_hour must be 0-23' })
  }
  const cleanRecipients = Array.isArray(recipients)
    ? recipients.map((s) => String(s).trim()).filter(Boolean)
    : []
  try {
    const saved = await saveSettings({ recipients: cleanRecipients, send_hour: hour, enabled: !!enabled })
    res.json(saved)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/grafana/tick — Supabase pg_cron이 매시간 호출. 설정대로 발송.
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

    const report = buildReport(await gatherReportData())
    await sendReportEmail(buildEmailHtml(report), recipients)
    await markSent(kstDateString(now))
    res.json({ sent: true, alerts: report.summary.alerts })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/routes/grafana.test.js server/grafana/schedule.test.js`
Expected: PASS (모든 테스트).

- [ ] **Step 5: Run full test suite + lint**

Run: `npm test && npm run lint`
Expected: 전체 PASS, lint 클린. (report.test.js의 buildEmailHtml 등 기존 테스트 영향 없음)

- [ ] **Step 6: Commit**

```bash
git add server/routes/grafana.js server/routes/grafana.test.js
git commit -m "feat(grafana): settings GET/PUT and tick endpoint (replaces cron)"
```

---

## Task 6: 프런트 API 클라이언트

**Files:**
- Modify: `src/lib/api/grafana.js`

- [ ] **Step 1: Append functions**

기존 `getReport`는 유지. 아래를 파일 끝에 추가.

```javascript
export async function getSettings(password) {
  const res = await fetch(`${BASE}/api/grafana/settings`, {
    headers: { 'x-app-password': password ?? '' },
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}

export async function updateSettings(body, password) {
  const res = await fetch(`${BASE}/api/grafana/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-app-password': password ?? '' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}
```

- [ ] **Step 2: Lint check**

Run: `npx eslint src/lib/api/grafana.js`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/grafana.js
git commit -m "feat(grafana): add settings api client (get/update)"
```

---

## Task 7: 설정 폼 컴포넌트

**Files:**
- Create: `src/components/grafana/GrafanaSettings.jsx`

- [ ] **Step 1: Write component**

메일러의 폼 클래스(`.form-field`/`.form-label`/`.form-input`/`.modal-submit`)와 `TagInput`을 재사용한다.

```jsx
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
      const s = await updateSettings({ recipients, send_hour: sendHour, enabled }, password)
      setRecipients(s.recipients ?? [])
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
        <p className="form-hint">이메일 입력 후 Enter. 비우면 자동 발송되지 않습니다.</p>
      </div>

      <div className="form-field">
        <label className="form-label">발송 시각 (KST)</label>
        <select
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

      {error && <div className="grafana-error">{error}</div>}
      <div className="modal-actions">
        <button type="submit" className="modal-submit" disabled={saving}>
          {saving ? '저장 중…' : saved ? '저장됨 ✓' : '저장'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Lint check**

Run: `npx eslint src/components/grafana/GrafanaSettings.jsx`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add src/components/grafana/GrafanaSettings.jsx
git commit -m "feat(grafana): settings form component (recipients/hour/enabled)"
```

---

## Task 8: GrafanaPage 탭 구성

**Files:**
- Modify: `src/pages/GrafanaPage.jsx`

- [ ] **Step 1: Rewrite `GrafanaPage.jsx`**

기존 리포트 뷰는 `리포트` 탭 안으로 옮기고, `설정` 탭에 `GrafanaSettings`를 둔다. 새로고침 버튼은 리포트 탭일 때만 보인다.

```jsx
// src/pages/GrafanaPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { getReport } from '../lib/api/grafana.js'
import { getCookie, clearCookie } from '../lib/auth.js'
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
                  <span className="grafana-time">{report.generatedAt?.slice(0, 16).replace('T', ' ')} UTC</span>
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
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint 클린, build 성공.

- [ ] **Step 3: Commit**

```bash
git add src/pages/GrafanaPage.jsx
git commit -m "feat(grafana): add report/settings tabs to GrafanaPage"
```

---

## Task 9: 설정 폼 스타일

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Append styles**

파일 끝(기존 `.grafana-*` 블록 근처)에 추가. 토글/폼 컨테이너 최소 스타일만.

```css
.grafana-settings { max-width: 520px; }
.grafana-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #c0c0d0;
  cursor: pointer;
}
.grafana-toggle input { width: 15px; height: 15px; accent-color: #9d8ffc; }
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style(grafana): settings form styles"
```

---

## Task 10: Vercel cron 제거 (pg_cron 일원화)

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Remove the crons entry**

`vercel.json`에서 `crons` 배열을 **삭제**한다(이중 발송 방지). 결과 파일:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore(grafana): remove vercel cron (moved to supabase pg_cron)"
```

---

## Task 11: 전체 검증

- [ ] **Step 1: 전체 테스트 + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: 전체 PASS. schedule 8 + grafana routes(report 3 + settings 5 + tick 4) 포함, 기존 테스트 영향 없음.

- [ ] **Step 2: 로컬 dev 수동 확인 (선택)**

Run: `npm run dev`
- `http://localhost:5173` → 로그인 → Grafana → "설정" 탭 → 수신자/시각/토글 저장 → 새로고침해도 유지되는지 확인.
- 주의: 설정 저장은 실제 Supabase에 기록됨(Task 4 마이그레이션 적용 후).

- [ ] **Step 3: tick 수동 확인 (선택, 메일 발송 주의)**

```bash
CRON_SECRET=$(grep -E '^CRON_SECRET=' .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/grafana/tick
```
Expected: 현재 KST 시 ≠ send_hour면 `{"sent":false,"reason":"not-time"}`. (조건 맞으면 실제 발송됨)

---

## 배포 (사용자 명시 승인 필요)

> push/배포는 매번 사용자 승인 필요. 코드 커밋은 main 직접 방식.

- [ ] **D1. 마이그레이션 적용** — Supabase SQL Editor에서 Task 4 SQL 실행(미적용 시).
- [ ] **D2. git push** — `git push origin main`.
- [ ] **D3. 배포** — `npx vercel --prod`.
- [ ] **D4. Supabase pg_cron 등록** — SQL Editor에서 아래 실행(`<CRON_SECRET>`은 Vercel/.env의 실제 값으로 치환):

```sql
-- pg_net + pg_cron 확장 필요 (Supabase 기본 제공). 매시간 정각 grafana tick 호출.
select cron.schedule(
  'grafana-report-tick',
  '0 * * * *',
  $$
  select net.http_get(
    url := 'https://mailer-two-chi.vercel.app/api/grafana/tick',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb
  );
  $$
);
```
확인: `select * from cron.job where jobname = 'grafana-report-tick';`

- [ ] **D5. 프로덕션 확인** — `/grafana` "설정" 탭에서 수신자/시각 저장. 예약 시각 도달 시 1회 수신 확인.

> 참고: 기존 Vercel cron은 D3 배포로 자동 해제(vercel.json에서 제거됨). 메일러의 pg_cron은 무관·무변경.
