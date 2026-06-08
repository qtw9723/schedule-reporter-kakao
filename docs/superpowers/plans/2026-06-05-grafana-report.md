# Grafana 리포트 툴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CS SmartHub에 Grafana 모니터링 리포트 툴 추가 — 웹 on-demand 조회(네이티브 React) + Vercel Cron 일일 이메일.

**Architecture:** 기존 Python 스크립트 로직을 Node로 포팅. 조회(client)/가공(report, 순수함수)/발송(email)/라우팅(routes)을 분리. Stateless 라이브 조회, 저장 없음. 기존 `api/index.js`(Express→Vercel 함수)와 `vercel.json` 위에 얹힘.

**Tech Stack:** Express, Node fetch, nodemailer, React 19, Vitest, supertest

---

## 파일 맵

### 신규
| 파일 | 책임 |
|------|------|
| `server/grafana/config.js` | METRICS/LOG_QUERIES 등 모니터링 정의 상수 |
| `server/grafana/report.js` | 순수 가공: extractPromValue/normalizeEsIndex/fmtTimeKst/parseEsResponses/buildReport/buildEmailHtml |
| `server/grafana/report.test.js` | report.js 단위 테스트 |
| `server/grafana/client.js` | Grafana API 호출 (Prometheus/ES) + gatherReportData 오케스트레이션 |
| `server/grafana/email.js` | nodemailer HTML 메일 발송 |
| `server/routes/grafana.test.js` | 라우터 테스트 (client/email 모킹) |
| `src/lib/api/grafana.js` | 프런트 API 클라이언트 |

### 수정
| 파일 | 변경 |
|------|------|
| `server/routes/grafana.js` | placeholder → /report, /cron 라우트 |
| `src/pages/GrafanaPage.jsx` | placeholder → 리포트 UI |
| `src/index.css` | `.grafana-*` 다크 테마 스타일 |
| `src/pages/HubPage.jsx` | grafana 카드 `active: true` |
| `vercel.json` | crons 추가 |
| `.env.example` | Grafana env 문서화 |

---

## Task 1: 모니터링 정의 상수 (config.js)

**Files:**
- Create: `server/grafana/config.js`

- [ ] **Step 1: config.js 작성**

```js
// server/grafana/config.js
// Python STEP 2 이식. 라벨이 다르면 기존 대시보드 패널 쿼리로 교체.

export const METRICS = [
  { label: 'CPU 사용률(최대, %)',
    query: 'max(max_over_time((100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100))[24h:5m]))',
    threshold: 80 },
  { label: '메모리 사용률(최대, %)',
    query: 'max(max_over_time(((1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100)[24h:5m]))',
    threshold: 85 },
  { label: '디스크 사용률(최대, %)',
    query: 'max(max_over_time(((1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes)) * 100)[24h:5m]))',
    threshold: 85 },
  { label: '비정상 상태 Pod 수',
    query: 'max(max_over_time(sum(kube_pod_status_phase{phase=~"Pending|Failed|Unknown"})[24h:5m]))',
    threshold: 0 },
  { label: '최근 24시간 Pod 재시작 횟수',
    query: 'sum(increase(kube_pod_container_status_restarts_total[24h]))',
    threshold: 0 },
]

export const LOG_QUERIES = [
  { label: 'chatbot',  query: 'app.keyword:"chatbot" && error' },
  { label: 'soe',      query: 'app.keyword:"soe" && error' },
  { label: 'c3',       query: 'app.keyword:"c3" && error' },
  { label: 'webhook',  query: 'app.keyword:"webhook" && error' },
  { label: 'docstore', query: 'app.keyword:"docstore" && error' },
]

export const LOG_HOURS = 24
export const LOG_FETCH = 50
export const LOG_SHOW = 5
```

- [ ] **Step 2: 커밋**

```bash
git add server/grafana/config.js
git commit -m "feat(grafana): add monitoring metric/log query config"
```

---

## Task 2: 순수 가공 함수 (report.js) — TDD

**Files:**
- Create: `server/grafana/report.test.js`
- Create: `server/grafana/report.js`

- [ ] **Step 1: 실패 테스트 작성**

```js
// server/grafana/report.test.js
import { describe, it, expect } from 'vitest'
import {
  extractPromValue, normalizeEsIndex, fmtTimeKst, parseEsResponses, buildReport, buildEmailHtml,
} from './report.js'

describe('extractPromValue', () => {
  it('frames의 마지막 값 추출', () => {
    const resp = { results: { A: { frames: [{ data: { values: [[1700000000000], [13.7]] } }] } } }
    expect(extractPromValue(resp)).toBe(13.7)
  })
  it('frames 없으면 null', () => {
    expect(extractPromValue({ results: { A: { frames: [] } } })).toBeNull()
    expect(extractPromValue({})).toBeNull()
  })
})

describe('normalizeEsIndex', () => {
  it('[prefix]날짜 템플릿 → prefix*', () => {
    expect(normalizeEsIndex('[out_logs-]YYYY.MM.DD')).toBe('out_logs-*')
  })
  it('일반 문자열은 그대로', () => {
    expect(normalizeEsIndex('logs-*')).toBe('logs-*')
  })
})

describe('fmtTimeKst', () => {
  it('UTC ISO → KST(+9) YYYY-MM-DD HH:MM', () => {
    expect(fmtTimeKst('2026-06-03T07:37:49.123Z')).toBe('2026-06-03 16:37')
  })
  it('빈 값은 빈 문자열', () => {
    expect(fmtTimeKst('')).toBe('')
  })
})

describe('parseEsResponses', () => {
  it('앱별 count와 rows 파싱', () => {
    const responses = [
      { hits: { total: { value: 2 }, hits: [
        { _source: { '@timestamp': '2026-06-03T07:37:49Z', message: 'boom' } },
      ] } },
      { hits: { total: { value: 0 }, hits: [] } },
    ]
    const queries = [{ label: 'soe' }, { label: 'c3' }]
    const out = parseEsResponses(responses, queries, '@timestamp')
    expect(out.soe.count).toBe(2)
    expect(out.soe.rows[0]).toEqual({ time: '2026-06-03 16:37', msg: 'boom' })
    expect(out.c3.count).toBe(0)
  })
  it('message 없으면 log→msg 순으로 폴백', () => {
    const responses = [{ hits: { total: { value: 1 }, hits: [{ _source: { '@timestamp': '', log: 'fromlog' } }] } }]
    const out = parseEsResponses(responses, [{ label: 'x' }], '@timestamp')
    expect(out.x.rows[0].msg).toBe('fromlog')
  })
})

describe('buildReport', () => {
  const base = {
    generatedAt: '2026-06-05T00:00:00.000Z',
    metrics: [
      { label: 'CPU', value: 13.7, threshold: 80, error: null },
      { label: 'MEM', value: 90, threshold: 85, error: null },
      { label: 'DISK', value: null, threshold: 85, error: '데이터 없음' },
    ],
    logs: [
      { app: 'soe', count: 1, rows: [], error: null },
      { app: 'c3', count: 0, rows: [], error: null },
    ],
  }
  it('임계 초과 메트릭 + 로그 1건 이상을 alerts로 합산', () => {
    const r = buildReport(base)
    expect(r.summary.alerts).toBe(2) // MEM 초과 + soe 1건
    expect(r.summary.status).toBe('alert')
  })
  it('over 플래그 계산', () => {
    const r = buildReport(base)
    expect(r.metrics.find(m => m.label === 'CPU').over).toBe(false)
    expect(r.metrics.find(m => m.label === 'MEM').over).toBe(true)
    expect(r.metrics.find(m => m.label === 'DISK').over).toBe(false)
  })
  it('이상 0건이면 status ok', () => {
    const r = buildReport({ generatedAt: 'x', metrics: [{ label: 'CPU', value: 1, threshold: 80, error: null }], logs: [] })
    expect(r.summary).toEqual({ alerts: 0, status: 'ok' })
  })
})

describe('buildEmailHtml', () => {
  it('요약과 앱 라벨이 포함된 HTML 반환', () => {
    const report = buildReport({
      generatedAt: '2026-06-05T00:00:00.000Z',
      metrics: [{ label: 'CPU', value: 13.7, threshold: 80, error: null }],
      logs: [{ app: 'soe', count: 1, rows: [{ time: '2026-06-03 16:37', msg: 'boom' }], error: null }],
    })
    const html = buildEmailHtml(report)
    expect(html).toContain('<html')
    expect(html).toContain('이상 1건')
    expect(html).toContain('soe')
    expect(html).toContain('boom')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run server/grafana/report.test.js`
Expected: FAIL — `report.js` 없음

- [ ] **Step 3: report.js 구현**

```js
// server/grafana/report.js

// Prometheus /api/ds/query 응답에서 마지막 값 추출
export function extractPromValue(resp) {
  try {
    const frames = resp?.results?.A?.frames
    if (!frames || !frames.length) return null
    const values = frames[0]?.data?.values
    if (!values || !values.length) return null
    const lastCol = values[values.length - 1]
    return lastCol && lastCol.length ? lastCol[lastCol.length - 1] : null
  } catch {
    return null
  }
}

// Grafana ES 인덱스 템플릿 [prefix]YYYY.MM.DD → prefix*
export function normalizeEsIndex(index) {
  return String(index).replace(/\[([^\]]+)\].*/, '$1*')
}

// UTC ISO → KST(+9) "YYYY-MM-DD HH:MM"
export function fmtTimeKst(ts) {
  if (!ts) return ''
  try {
    const base = String(ts).replace('Z', '').split('.')[0]
    const d = new Date(base + 'Z')
    if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
    const kst = new Date(d.getTime() + 9 * 3600 * 1000)
    const p = (n) => String(n).padStart(2, '0')
    return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
  } catch {
    return String(ts).slice(0, 16)
  }
}

// _msearch responses[] → {label: {count, rows}}
export function parseEsResponses(responses, queries, timefield) {
  const out = {}
  for (let i = 0; i < queries.length; i++) {
    const resp = responses[i] || {}
    const hits = resp.hits || {}
    const total = hits.total
    const count = (total && typeof total === 'object') ? (total.value || 0) : (total || 0)
    const rows = (hits.hits || []).map((h) => {
      const src = h._source || {}
      const ts = src[timefield] || ''
      const msg = src.message || src.log || src.msg || JSON.stringify(src)
      return { time: fmtTimeKst(String(ts)), msg: String(msg) }
    })
    out[queries[i].label] = { count, rows }
  }
  return out
}

// 수집된 원시 결과 → 최종 리포트 JSON (요약/over/alerts 계산)
export function buildReport({ metrics, logs, generatedAt }) {
  let alerts = 0
  const m = metrics.map((x) => {
    let over = false
    if (x.error == null && x.value != null) {
      const v = Number(x.value)
      over = !Number.isNaN(v) && v > x.threshold
    }
    if (over) alerts++
    return { label: x.label, value: x.value ?? null, threshold: x.threshold, over, error: x.error ?? null }
  })
  const l = logs.map((x) => {
    if (!x.error && x.count) alerts++
    return { app: x.app, count: x.count ?? 0, rows: x.rows ?? [], error: x.error ?? null }
  })
  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    summary: { alerts, status: alerts ? 'alert' : 'ok' },
    metrics: m,
    logs: l,
  }
}

// 이메일용 HTML (라이트 테마, 메일 클라이언트 호환)
export function buildEmailHtml(report) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const alerts = report.summary.alerts
  const summaryText = alerts ? `⚠️ 이상 ${alerts}건 — 점검 필요` : '✅ 정상'
  const sc = alerts ? '#c62828' : '#2e7d32'

  const metricRows = report.metrics.map((m) => {
    const v = m.error ? m.error : (m.value == null ? '데이터 없음' : (typeof m.value === 'number' ? m.value.toFixed(1) : m.value))
    const mark = m.over ? '⚠' : (m.error || m.value == null ? '○' : '✓')
    return `<tr><td>${mark} ${esc(m.label)}</td><td style="text-align:right">${esc(v)}</td><td style="text-align:right">${m.threshold}</td></tr>`
  }).join('')

  const logBlocks = report.logs.map((g) => {
    const mark = g.count ? '⚠' : '✓'
    const head = `<div style="margin:10px 0 6px"><strong>${mark} ${esc(g.app)}</strong>: ${g.error ? esc(g.error) : g.count + '건'}</div>`
    if (!g.count || g.error) return head
    const rows = g.rows.slice(0, 5).map((r) => `<tr><td style="color:#999;font-size:12px">${esc(r.time)}</td><td>${esc(r.msg.slice(0, 150))}</td></tr>`).join('')
    return head + `<table style="width:100%;border-collapse:collapse">${rows}</table>`
  }).join('')

  return `<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;padding:20px">
<div style="max-width:800px;margin:0 auto;background:#fff;padding:20px;border-radius:8px">
<h1 style="font-size:22px;margin:0 0 6px">📊 그라파나 모니터링 보고서</h1>
<div style="color:#666;font-size:13px;margin-bottom:16px">${esc(fmtTimeKst(report.generatedAt))} (KST)</div>
<div style="padding:12px;border-radius:6px;font-weight:bold;color:${sc};background:${alerts ? '#ffebee' : '#e8f5e9'};border-left:4px solid ${sc};margin-bottom:18px">${summaryText}</div>
<div style="font-weight:bold;margin-bottom:8px">📈 리소스 사용량</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tr><th style="text-align:left">항목</th><th style="text-align:right">값</th><th style="text-align:right">임계</th></tr>${metricRows}</table>
<div style="font-weight:bold;margin-bottom:4px">🔍 ERROR 로그 (앱별)</div>${logBlocks}
</div></body></html>`
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run server/grafana/report.test.js`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add server/grafana/report.js server/grafana/report.test.js
git commit -m "feat(grafana): add pure report-building functions with tests"
```

---

## Task 3: Grafana API 클라이언트 (client.js)

**Files:**
- Create: `server/grafana/client.js`

> client.js는 외부 Grafana 의존이라 단위테스트 제외. 로직(파싱)은 report.js에 있어 테스트됨. 실제 검증은 Task 9 수동 점검.

- [ ] **Step 1: client.js 작성**

```js
// server/grafana/client.js
import { METRICS, LOG_QUERIES, LOG_HOURS, LOG_FETCH } from './config.js'
import { extractPromValue, normalizeEsIndex, parseEsResponses } from './report.js'

const TIMEOUT = 30000

function cfg() {
  const url = (process.env.GRAFANA_URL || '').replace(/\/$/, '')
  const token = process.env.GRAFANA_TOKEN || ''
  if (!url || !token) throw new Error('GRAFANA_URL / GRAFANA_TOKEN 미설정')
  return { url, token }
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${cfg().token}`, ...extra }
}

export async function queryPrometheus(expr) {
  const { url } = cfg()
  const body = {
    from: 'now-5m', to: 'now',
    queries: [{ refId: 'A', datasource: { uid: process.env.PROM_UID }, expr, instant: true }],
  }
  const r = await fetch(`${url}/api/ds/query`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`prometheus ${r.status}`)
  return extractPromValue(await r.json())
}

export async function getEsIndexAndTimeField(uid) {
  const { url } = cfg()
  const r = await fetch(`${url}/api/datasources/uid/${uid}`, {
    headers: headers(), signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`es datasource ${r.status}`)
  const ds = await r.json()
  const jd = ds.jsonData || {}
  return {
    index: normalizeEsIndex(jd.index || ds.database || '*'),
    timefield: jd.timeField || '@timestamp',
  }
}

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
  const payload = nd.join('\n') + '\n'
  const r = await fetch(`${url}/api/datasources/proxy/uid/${uid}/_msearch`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/x-ndjson' }),
    body: payload,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`elasticsearch ${r.status}`)
  const json = await r.json()
  return parseEsResponses(json.responses || [], queries, timefield)
}

// 메트릭/로그를 모두 조회해 buildReport 입력 형태로 반환. 개별 실패는 격리.
export async function gatherReportData() {
  const metrics = await Promise.all(METRICS.map(async (m) => {
    try {
      const value = await queryPrometheus(m.query)
      return { label: m.label, value, threshold: m.threshold, error: value == null ? '데이터 없음' : null }
    } catch {
      return { label: m.label, value: null, threshold: m.threshold, error: '조회 실패' }
    }
  }))

  let logs
  try {
    const res = await queryElasticsearch(LOG_QUERIES, LOG_HOURS, LOG_FETCH)
    logs = LOG_QUERIES.map((lq) => ({
      app: lq.label,
      count: res[lq.label]?.count ?? 0,
      rows: res[lq.label]?.rows ?? [],
      error: null,
    }))
  } catch {
    logs = LOG_QUERIES.map((lq) => ({ app: lq.label, count: 0, rows: [], error: '조회 실패' }))
  }

  return { metrics, logs }
}
```

- [ ] **Step 2: 구문 점검**

Run: `node --check server/grafana/client.js`
Expected: 출력 없음(성공)

- [ ] **Step 3: 커밋**

```bash
git add server/grafana/client.js
git commit -m "feat(grafana): add grafana api client and report orchestration"
```

---

## Task 4: 이메일 발송 (email.js)

**Files:**
- Create: `server/grafana/email.js`

- [ ] **Step 1: email.js 작성**

```js
// server/grafana/email.js
import nodemailer from 'nodemailer'

export async function sendReportEmail(html) {
  const from = process.env.GRAFANA_EMAIL_FROM
  const pass = process.env.GRAFANA_EMAIL_PASSWORD
  const to = process.env.GRAFANA_EMAIL_TO
  if (!from || !pass || !to) throw new Error('GRAFANA_EMAIL_* 미설정')

  const recipients = to.split(',').map((s) => s.trim()).filter(Boolean)
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: from, pass },
  })
  await transporter.sendMail({
    from,
    to: recipients,
    subject: '[Next-TI 운영] 그라파나 모니터링 보고서',
    html,
  })
}
```

- [ ] **Step 2: 구문 점검 + 커밋**

```bash
node --check server/grafana/email.js
git add server/grafana/email.js
git commit -m "feat(grafana): add report email sender via nodemailer"
```

---

## Task 5: Express 라우터 (routes/grafana.js) — TDD

**Files:**
- Create: `server/routes/grafana.test.js`
- Modify: `server/routes/grafana.js`

- [ ] **Step 1: 실패 테스트 작성**

```js
// server/routes/grafana.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../grafana/client.js', () => ({
  gatherReportData: vi.fn(),
}))
vi.mock('../grafana/email.js', () => ({
  sendReportEmail: vi.fn(),
}))

import { gatherReportData } from '../grafana/client.js'
import { sendReportEmail } from '../grafana/email.js'
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
    expect(res.body.metrics[0].label).toBe('CPU')
  })
  it('Grafana 조회 실패 시 502', async () => {
    gatherReportData.mockRejectedValueOnce(new Error('grafana down'))
    const res = await request(app).get('/api/grafana/report').set('x-app-password', 'test-pw')
    expect(res.status).toBe(502)
  })
})

describe('GET /api/grafana/cron', () => {
  it('CRON_SECRET 없으면 401', async () => {
    const res = await request(app).get('/api/grafana/cron')
    expect(res.status).toBe(401)
  })
  it('올바른 Bearer면 조회+메일 발송 후 sent 반환', async () => {
    gatherReportData.mockResolvedValueOnce(SAMPLE)
    sendReportEmail.mockResolvedValueOnce()
    const res = await request(app).get('/api/grafana/cron').set('Authorization', 'Bearer cron-secret')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: true, alerts: 0 })
    expect(sendReportEmail).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run server/routes/grafana.test.js`
Expected: FAIL — 라우트가 placeholder라 `/report` 401 아님 등

- [ ] **Step 3: grafana.js 구현 (placeholder 교체)**

```js
// server/routes/grafana.js
import { Router } from 'express'
import { gatherReportData } from '../grafana/client.js'
import { buildReport, buildEmailHtml } from '../grafana/report.js'
import { sendReportEmail } from '../grafana/email.js'

const router = Router()

function auth(req, res, next) {
  if (req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
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

// GET /api/grafana/cron — Vercel Cron이 호출. 조회 후 이메일 발송.
router.get('/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const report = buildReport(await gatherReportData())
    await sendReportEmail(buildEmailHtml(report))
    res.json({ sent: true, alerts: report.summary.alerts })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run server/routes/grafana.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/routes/grafana.js server/routes/grafana.test.js
git commit -m "feat(grafana): add /report and /cron express routes with tests"
```

---

## Task 6: 프런트 API 클라이언트 (grafana.js)

**Files:**
- Create: `src/lib/api/grafana.js`

- [ ] **Step 1: grafana.js 작성**

```js
// src/lib/api/grafana.js
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export async function getReport(password) {
  const res = await fetch(`${BASE}/api/grafana/report`, {
    headers: { 'x-app-password': password ?? '' },
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/api/grafana.js
git commit -m "feat(grafana): add frontend report api client"
```

---

## Task 7: GrafanaPage UI + 스타일 + 허브 활성화

**Files:**
- Modify: `src/pages/GrafanaPage.jsx`
- Modify: `src/index.css`
- Modify: `src/pages/HubPage.jsx`

- [ ] **Step 1: GrafanaPage.jsx 교체**

```jsx
// src/pages/GrafanaPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { getReport } from '../lib/api/grafana.js'
import { getCookie, clearCookie } from '../lib/auth.js'
import AppHeader from '../components/shared/AppHeader.jsx'

export default function GrafanaPage() {
  const password = getCookie()
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

  useEffect(() => { load() }, [load])

  const alerts = report?.summary?.alerts ?? 0

  return (
    <div className="app">
      <AppHeader toolName="Grafana 리포트">
        <button className="app-new-btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> 새로고침
        </button>
      </AppHeader>

      <div className="grafana-wrap">
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
      </div>
    </div>
  )
}
```

- [ ] **Step 2: src/index.css 끝에 스타일 추가**

```css
/* ── Grafana 리포트 ── */
.grafana-wrap { padding: 20px 24px; max-width: 900px; margin: 0 auto; }
.grafana-error { background: rgba(198,40,40,0.12); color: #ff8a80; border: 1px solid rgba(198,40,40,0.3); padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
.grafana-summary { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-radius: 10px; font-weight: 700; font-size: 15px; margin-bottom: 20px; }
.grafana-summary.ok { background: rgba(46,125,50,0.15); color: #81c784; border: 1px solid rgba(46,125,50,0.35); }
.grafana-summary.alert { background: rgba(198,40,40,0.15); color: #ff8a80; border: 1px solid rgba(198,40,40,0.35); }
.grafana-time { font-size: 12px; font-weight: 400; color: #808090; }
.grafana-section { margin-bottom: 26px; }
.grafana-section-title { font-size: 14px; font-weight: 600; color: #c8c8d8; margin: 0 0 12px; }
.grafana-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.grafana-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-left-width: 3px; }
.grafana-card.ok { border-left-color: #2e7d32; }
.grafana-card.warn { border-left-color: #c62828; }
.grafana-card.na { border-left-color: #555; opacity: 0.7; }
.grafana-card-label { font-size: 12px; color: #9090a0; }
.grafana-card-value { font-size: 20px; font-weight: 700; color: #e8e8f0; }
.grafana-card-threshold { font-size: 11px; color: #606070; }
.grafana-log-group { margin-bottom: 14px; }
.grafana-log-head { font-size: 13px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
.grafana-log-head.warn { color: #ff8a80; }
.grafana-log-head.ok { color: #81c784; }
.grafana-log-head.na { color: #909090; }
.grafana-log-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.grafana-log-table td { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top; }
.grafana-log-time { color: #707080; font-size: 11px; white-space: nowrap; width: 130px; }
.grafana-log-msg { color: #b8b8c8; font-size: 12px; word-break: break-word; }
.spin { animation: grafana-spin 1s linear infinite; }
@keyframes grafana-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: HubPage.jsx에서 grafana 카드 활성화**

`src/pages/HubPage.jsx`의 TOOLS 배열에서 grafana 항목의 `active: false`를 `active: true`로 변경:

```js
  {
    id: 'grafana',
    icon: '📊',
    name: 'Grafana 리포트',
    description: '모니터링 리포트 생성',
    path: '/grafana',
    active: true,
  },
```

- [ ] **Step 4: 빌드 확인 + 커밋**

```bash
npm run build
git add src/pages/GrafanaPage.jsx src/index.css src/pages/HubPage.jsx
git commit -m "feat(grafana): native report UI, styles, activate hub card"
```

Expected: 빌드 성공

---

## Task 8: Vercel Cron + env 문서화

**Files:**
- Modify: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1: vercel.json에 crons 추가**

기존 rewrites는 유지하고 `crons` 키 추가:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "crons": [
    { "path": "/api/grafana/cron", "schedule": "0 0 * * *" }
  ]
}
```

- [ ] **Step 2: .env.example에 Grafana 변수 추가**

파일 끝에 추가:

```
# ── Grafana 리포트 ──
GRAFANA_URL=https://grafana.next-ti.ai
GRAFANA_TOKEN=glsa_xxx
PROM_UID=
ES_UID=
GRAFANA_EMAIL_FROM=
GRAFANA_EMAIL_PASSWORD=
GRAFANA_EMAIL_TO=
CRON_SECRET=
```

- [ ] **Step 3: 커밋**

```bash
git add vercel.json .env.example
git commit -m "feat(grafana): add daily vercel cron and document env vars"
```

---

## Task 9: 로컬 env 설정 + 전체 검증

**Files:**
- Modify: `.env` (로컬, 커밋 안 함)

- [ ] **Step 1: 로컬 .env에 Grafana 값 입력**

기존 Python `.env`(`~/grafana-monitoring/.env`)의 값을 참고해 프로젝트 `.env`에 추가:
`GRAFANA_URL`, `GRAFANA_TOKEN`, `PROM_UID`, `ES_UID`, `GRAFANA_EMAIL_FROM/PASSWORD/TO`, `CRON_SECRET`(임의 문자열).

PROM_UID/ES_UID를 모르면 다음으로 확인:
```bash
curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" "$GRAFANA_URL/api/datasources" | node -e 'JSON.parse(require("fs").readFileSync(0)).forEach(d=>console.log(d.type,d.uid,d.name))'
```

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: mailer + auth + grafana(report, routes) 전부 PASS

- [ ] **Step 3: 로컬 dev 기동 후 /report 수동 확인**

```bash
# 서버만
node server/index.js
# 다른 터미널
APP_PW=$(grep -E '^APP_PASSWORD=' .env | cut -d= -f2-)
curl -s -H "x-app-password: $APP_PW" http://localhost:3001/api/grafana/report | head -c 400
```
Expected: `{"generatedAt":...,"summary":{...},"metrics":[...],"logs":[...]}`
메트릭이 "데이터 없음"이면 config.js의 PromQL을 기존 대시보드 쿼리로 교체.

- [ ] **Step 4: 브라우저 UI 확인**

`npm run dev` → `http://localhost:5173` → 로그인 → 허브에서 **Grafana 리포트** 카드 클릭 → 요약/카드/로그 렌더 확인. "새로고침" 동작 확인.

- [ ] **Step 5: lint + 최종 커밋**

```bash
npm run lint
git add -A
git commit -m "chore(grafana): finalize grafana report tool"
```

---

## 배포 (별도, 사용자 확인 후)

로컬 검증 완료 후:
1. Vercel Production env에 8개 변수 주입 (`GRAFANA_*`, `PROM_UID`, `ES_UID`, `CRON_SECRET`)
2. `vercel --prod` 재배포 → Cron은 Vercel이 자동 등록
3. `/api/grafana/cron`은 Vercel Cron(Bearer CRON_SECRET)만 호출 가능 — 외부 접근 차단 확인
