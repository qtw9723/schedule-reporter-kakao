# CS SmartHub Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mailer 앱을 CS SmartHub 허브로 전환 — 대문 홈에서 툴을 선택하고, 백엔드를 Supabase Edge Functions(Deno)에서 Node.js Express로 교체한다.

**Architecture:** React Router를 추가해 `/`(허브 홈), `/mailer`, `/grafana`, `/chatbot` 경로를 분리한다. 인증은 기존 비밀번호+쿠키 방식을 유지하되 허브 레벨로 올린다. Express 서버(`server/`)가 기존 Edge Function 로직을 대체하고, Vite dev proxy로 `/api/*`를 Express로 포워딩한다.

**Tech Stack:** React 19, React Router v6, Vite 8, Tailwind 4, Express, pg (node-postgres), nodemailer, concurrently, vitest, supertest

---

## 파일 맵

### 신규 생성

| 파일 | 역할 |
|------|------|
| `server/index.js` | Express 앱 진입점, 미들웨어, 라우터 등록 |
| `server/db.js` | pg Pool — Supabase PostgreSQL 연결 |
| `server/smtp.js` | nodemailer 래퍼 (Deno smtp.ts 이식) |
| `server/routes/mailer.js` | Mailer CRUD + tick 엔드포인트 |
| `server/routes/grafana.js` | placeholder 라우터 |
| `server/routes/chatbot.js` | placeholder 라우터 |
| `server/routes/mailer.test.js` | supertest + vitest로 API 테스트 |
| `src/lib/auth.js` | getCookie / setCookie / clearCookie 공통 모듈 |
| `src/lib/api/mailer.js` | Express 기반 API 호출 함수 (api.js 교체) |
| `src/pages/LoginPage.jsx` | 비밀번호 로그인 화면 (App.jsx gate 추출) |
| `src/pages/HubPage.jsx` | 툴 카드 선택 허브 홈 |
| `src/pages/MailerPage.jsx` | 현재 App.jsx jobs/senders 영역 |
| `src/pages/GrafanaPage.jsx` | "준비 중" placeholder |
| `src/pages/ChatbotPage.jsx` | "준비 중" placeholder |
| `src/components/shared/AppHeader.jsx` | 툴 내부 공통 헤더 (← CS SmartHub + 툴명) |
| `src/components/shared/ProtectedRoute.jsx` | 미인증 시 /login 리다이렉트 |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `package.json` | 프로젝트명 cs-smarthub, 의존성 추가, 스크립트 추가 |
| `vite.config.js` | `/api` 프록시 추가 |
| `src/App.jsx` | React Router + 라우트 설정으로 교체 |
| `src/index.css` | 허브 홈·공통 헤더 스타일 추가 |
| `src/components/JobModal.jsx` | import 경로 업데이트 (`../lib/storage.js` → 동일) |
| `src/components/JobCard.jsx` | 변경 없음 (import만 확인) |
| `.env.example` | 새 환경변수 추가 |

### 이동 (내용 변경 없이 경로 변경)

`src/components/JobCard.jsx` → `src/components/mailer/JobCard.jsx`  
`src/components/JobModal.jsx` → `src/components/mailer/JobModal.jsx`  
`src/components/SenderPage.jsx` → `src/components/mailer/SenderPage.jsx`  
`src/components/SenderModal.jsx` → `src/components/mailer/SenderModal.jsx`  
`src/components/TagInput.jsx` → `src/components/mailer/TagInput.jsx`

---

## Task 1: 프로젝트 이름 변경 & 의존성 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: package.json 이름 변경 및 의존성 추가**

```json
{
  "name": "cs-smarthub",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"vite\" \"node server/index.js\"",
    "dev:client": "vite",
    "dev:server": "node server/index.js",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@supabase/supabase-js": "^2.101.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "lucide-react": "^1.7.0",
    "nodemailer": "^6.9.16",
    "pg": "^8.13.3",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^6.30.1",
    "tailwindcss": "^4.2.2"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.4",
    "@tailwindcss/vite": "^4.2.2",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "concurrently": "^9.1.2",
    "eslint": "^9.39.4",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.4.0",
    "jsdom": "^26.1.0",
    "supertest": "^7.0.0",
    "vite": "^8.0.1",
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: 패키지 설치**

```bash
npm install
```

Expected: 의존성 설치 완료, `package-lock.json` 업데이트

- [ ] **Step 3: vitest 설정을 vite.config.js에 추가 (지금은 스킵, Task 12에서 처리)**

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore: rename to cs-smarthub, add express/router/test deps"
```

---

## Task 2: Auth 모듈 추출

**Files:**
- Create: `src/lib/auth.js`
- Create: `src/lib/auth.test.js`

- [ ] **Step 1: auth.test.js 작성**

```js
// src/lib/auth.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { getCookie, setCookie, clearCookie, COOKIE_NAME } from './auth.js'

beforeEach(() => {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
})

describe('getCookie', () => {
  it('쿠키가 없으면 빈 문자열 반환', () => {
    expect(getCookie()).toBe('')
  })
  it('setCookie 후 getCookie로 값 읽기', () => {
    setCookie('secret123')
    expect(getCookie()).toBe('secret123')
  })
})

describe('clearCookie', () => {
  it('clearCookie 후 getCookie는 빈 문자열', () => {
    setCookie('secret123')
    clearCookie()
    expect(getCookie()).toBe('')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/lib/auth.test.js
```

Expected: FAIL — `auth.js` 없음

- [ ] **Step 3: auth.js 구현**

```js
// src/lib/auth.js
export const COOKIE_NAME = 'smarthub-password'
const COOKIE_MINUTES = 10

export function getCookie() {
  const match = document.cookie.split('; ').find(r => r.startsWith(COOKIE_NAME + '='))
  return match ? decodeURIComponent(match.split('=')[1]) : ''
}

export function setCookie(value) {
  const expires = new Date(Date.now() + COOKIE_MINUTES * 60 * 1000).toUTCString()
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`
}

export function clearCookie() {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
}
```

- [ ] **Step 4: vitest 환경 설정 (jsdom 필요)**

`vite.config.js` 상단에 아래 추가:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: [],
  },
})
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/auth.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/auth.js src/lib/auth.test.js vite.config.js
git commit -m "feat: extract auth cookie module with tests"
```

---

## Task 3: Frontend API 클라이언트 교체

**Files:**
- Create: `src/lib/api/mailer.js`
- (기존 `src/lib/api.js`는 Task 7에서 삭제)

- [ ] **Step 1: src/lib/api/ 디렉터리 생성 후 mailer.js 작성**

Express의 새 REST 경로를 사용한다. 개발 시 Vite proxy가 `/api/*`를 Express로 포워딩하므로 상대 경로 사용.

```js
// src/lib/api/mailer.js
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request(method, path, body = null, password) {
  const res = await fetch(`${BASE}/api/mailer${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-app-password': password ?? '',
    },
    body: body ? JSON.stringify(body) : null,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (method === 'DELETE') return null
  return res.json()
}

export const getJobs = (pw) => request('GET', '/jobs', null, pw)
export const createJob = (job, pw) => request('POST', '/jobs', job, pw)
export const updateJob = (id, patch, pw) => request('PATCH', `/jobs/${id}`, patch, pw)
export const deleteJob = (id, pw) => request('DELETE', `/jobs/${id}`, null, pw)
export const reorderJobs = (ids, pw) =>
  Promise.all(ids.map((id, i) => request('PATCH', `/jobs/${id}`, { sort_order: i }, pw)))

export const getSenders = (pw) => request('GET', '/senders', null, pw)
export const createSender = (data, pw) => request('POST', '/senders', data, pw)
export const deleteSender = (id, pw) => request('DELETE', `/senders/${id}`, null, pw)
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/api/mailer.js
git commit -m "feat: add express-based mailer API client"
```

---

## Task 4: Express 서버 기반 구조

**Files:**
- Create: `server/index.js`
- Create: `server/db.js`

- [ ] **Step 1: server/db.js 작성**

```js
// server/db.js
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export default pool
```

- [ ] **Step 2: server/index.js 작성**

```js
// server/index.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mailerRouter from './routes/mailer.js'
import grafanaRouter from './routes/grafana.js'
import chatbotRouter from './routes/chatbot.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: 'http://localhost:5173', credentials: true }))
app.use(express.json())

app.use('/api/mailer', mailerRouter)
app.use('/api/grafana', grafanaRouter)
app.use('/api/chatbot', chatbotRouter)

app.listen(PORT, () => console.log(`CS SmartHub server running on :${PORT}`))

export default app
```

- [ ] **Step 3: placeholder 라우터 생성**

```js
// server/routes/grafana.js
import { Router } from 'express'
const router = Router()
router.get('/', (_req, res) => res.json({ status: 'not implemented' }))
export default router
```

```js
// server/routes/chatbot.js
import { Router } from 'express'
const router = Router()
router.get('/', (_req, res) => res.json({ status: 'not implemented' }))
export default router
```

- [ ] **Step 4: .env.example 업데이트**

```
# Frontend
VITE_API_BASE_URL=

# Backend
DATABASE_URL=
APP_PASSWORD=
GMAIL_USER=
GMAIL_APP_PASSWORD=
MS_USER=
MS_APP_PASSWORD=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3001
```

- [ ] **Step 5: .env에 DATABASE_URL 추가**

Supabase 대시보드 → Project Settings → Database → Connection string (URI) 에서 복사.  
`.env` 파일에 `DATABASE_URL=<복사한 값>` 추가.

- [ ] **Step 6: 서버 기동 확인**

```bash
node server/index.js
```

Expected: `CS SmartHub server running on :3001`

- [ ] **Step 7: 커밋**

```bash
git add server/index.js server/db.js server/routes/grafana.js server/routes/chatbot.js .env.example
git commit -m "feat: scaffold express server with db connection and placeholder routes"
```

---

## Task 5: smtp.js 이식 (Deno → Node.js)

**Files:**
- Create: `server/smtp.js`

- [ ] **Step 1: server/smtp.js 작성**

Deno의 `smtp.ts`를 Node.js용으로 변환. Deno API(`Deno.env.get`, `jsr:` imports) 제거.

```js
// server/smtp.js
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function fetchAttachment(path) {
  const supabase = getSupabase()
  const { data, error } = await supabase.storage.from('attachments').download(path)
  if (error || !data) throw new Error(`첨부파일 다운로드 실패: ${path}`)
  const buffer = await data.arrayBuffer()
  return { content: Buffer.from(buffer), contentType: data.type || 'application/octet-stream' }
}

export async function sendMail({ sender, senderEmail, senderPassword, to, subject, body, attachments = [] }) {
  const isGmail = senderEmail ? true : sender === 'gmail'
  const user = senderEmail ?? (isGmail ? process.env.GMAIL_USER : process.env.MS_USER)
  const password = senderPassword ?? (isGmail ? process.env.GMAIL_APP_PASSWORD : process.env.MS_APP_PASSWORD)

  const transporter = nodemailer.createTransport({
    host: isGmail ? 'smtp.gmail.com' : 'smtp-mail.outlook.com',
    port: isGmail ? 465 : 587,
    secure: isGmail,
    auth: { user, pass: password },
  })

  const attachmentList = await Promise.all(
    attachments.map(async (a) => {
      const { content, contentType } = await fetchAttachment(a.path)
      return { filename: a.name, content, contentType }
    })
  )

  await transporter.sendMail({
    from: user,
    to,
    subject,
    text: body,
    ...(attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  })
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/smtp.js
git commit -m "feat: port smtp mailer from deno to node.js"
```

---

## Task 6: Mailer Express 라우터

**Files:**
- Create: `server/routes/mailer.js`
- Create: `server/routes/mailer.test.js`

- [ ] **Step 1: mailer.test.js 작성 (먼저)**

```js
// server/routes/mailer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { Router } from 'express'

// DB 모킹
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}))

import db from '../db.js'

// 라우터만 테스트 — smtp는 모킹
vi.mock('../smtp.js', () => ({ sendMail: vi.fn() }))

const { default: mailerRouter } = await import('./mailer.js')
const app = express()
app.use(express.json())
app.use('/api/mailer', mailerRouter)

const AUTH = { 'x-app-password': 'test-password' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_PASSWORD = 'test-password'
})

describe('GET /api/mailer/jobs', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).get('/api/mailer/jobs')
    expect(res.status).toBe(401)
  })

  it('인증 성공 시 작업 목록 반환', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: '1', name: 'test' }] })
    const res = await request(app).get('/api/mailer/jobs').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: '1', name: 'test' }])
  })
})

describe('POST /api/mailer/jobs', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).post('/api/mailer/jobs').send({ name: 'test' })
    expect(res.status).toBe(401)
  })

  it('작업 생성 후 201 반환', async () => {
    const job = { id: '1', name: 'test', recipients: [], interval_minutes: 60 }
    db.query.mockResolvedValueOnce({ rows: [job] })
    const res = await request(app).post('/api/mailer/jobs').set(AUTH).send(job)
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('test')
  })
})

describe('DELETE /api/mailer/jobs/:id', () => {
  it('첨부파일 없는 작업 삭제', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: '1', attachments: [] }] }) // getJob
      .mockResolvedValueOnce({ rows: [] })                               // deleteJob
    const res = await request(app).delete('/api/mailer/jobs/1').set(AUTH)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run server/routes/mailer.test.js
```

Expected: FAIL — `mailer.js` 없음

- [ ] **Step 3: server/routes/mailer.js 구현**

```js
// server/routes/mailer.js
import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import db from '../db.js'
import { sendMail } from '../smtp.js'

const router = Router()

function auth(req, res, next) {
  if (req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// GET /api/mailer/jobs
router.get('/jobs', auth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM mail_jobs ORDER BY sort_order ASC, created_at DESC')
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mailer/jobs
router.post('/jobs', auth, async (req, res) => {
  const { name, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments } = req.body
  try {
    const { rows } = await db.query(
      `INSERT INTO mail_jobs (name, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, sender, sender_account_id || null, subject, body, recipients, interval_minutes, use_index ?? false, JSON.stringify(attachments ?? [])]
    )
    res.status(201).json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/mailer/jobs/:id
router.patch('/jobs/:id', auth, async (req, res) => {
  const { id } = req.params
  const fields = req.body
  const keys = Object.keys(fields)
  if (keys.length === 0) return res.status(400).json({ error: 'no fields' })

  const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`)
  const values = keys.map(k => fields[k])

  try {
    const { rows } = await db.query(
      `UPDATE mail_jobs SET ${setClauses.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    )
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/mailer/jobs/:id
router.delete('/jobs/:id', auth, async (req, res) => {
  const { id } = req.params
  try {
    const { rows } = await db.query('SELECT * FROM mail_jobs WHERE id = $1', [id])
    const job = rows[0]
    if (job?.attachments?.length) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      await supabase.storage.from('attachments').remove(job.attachments.map(a => a.path))
    }
    await db.query('DELETE FROM mail_jobs WHERE id = $1', [id])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/mailer/senders
router.get('/senders', auth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT id, email, created_at FROM sender_accounts ORDER BY created_at ASC')
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mailer/senders
router.post('/senders', auth, async (req, res) => {
  const { email, app_password } = req.body
  try {
    const { rows } = await db.query(
      'INSERT INTO sender_accounts (email, app_password) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, app_password]
    )
    res.status(201).json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/mailer/senders/:id
router.delete('/senders/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM sender_accounts WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mailer/tick — 스케줄러(pg_cron 또는 Vercel Cron)가 호출
router.post('/tick', async (_req, res) => {
  try {
    const now = Date.now()
    const { rows: jobs } = await db.query('SELECT * FROM mail_jobs WHERE is_active = true')
    const due = jobs.filter(job => {
      if (!job.last_sent_at) return true
      return now >= new Date(job.last_sent_at).getTime() + job.interval_minutes * 60_000
    })

    const results = await Promise.allSettled(
      due.map(async (job) => {
        const subject = job.use_index ? `[${job.send_count + 1}] ${job.subject}` : job.subject

        let sendOpts = { sender: job.sender }
        if (job.sender_account_id) {
          const { rows } = await db.query('SELECT * FROM sender_accounts WHERE id = $1', [job.sender_account_id])
          const account = rows[0]
          if (!account) throw new Error(`Sender account not found: ${job.sender_account_id}`)
          sendOpts = { senderEmail: account.email, senderPassword: account.app_password }
        }

        for (const recipient of job.recipients) {
          await sendMail({ ...sendOpts, to: recipient, subject, body: job.body, attachments: job.attachments })
        }

        await db.query(
          'UPDATE mail_jobs SET last_sent_at = NOW(), send_count = $1 WHERE id = $2',
          [job.send_count + 1, job.id]
        )
      })
    )

    const failed = results.filter(r => r.status === 'rejected').length
    res.json({ processed: due.length, failed })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run server/routes/mailer.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/routes/mailer.js server/routes/mailer.test.js
git commit -m "feat: add express mailer routes with tests"
```

---

## Task 7: 공통 컴포넌트 — AppHeader & ProtectedRoute

**Files:**
- Create: `src/components/shared/AppHeader.jsx`
- Create: `src/components/shared/ProtectedRoute.jsx`

- [ ] **Step 1: AppHeader.jsx 작성**

```jsx
// src/components/shared/AppHeader.jsx
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, LogOut } from 'lucide-react'
import { clearCookie } from '../../lib/auth.js'

export default function AppHeader({ toolName, children }) {
  const navigate = useNavigate()

  const handleLogout = () => {
    clearCookie()
    navigate('/login')
  }

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button className="hub-back-btn" onClick={() => navigate('/')}>
          <ChevronLeft size={14} /> CS SmartHub
        </button>
        <span className="hub-divider">|</span>
        <span className="app-title">{toolName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {children}
        <button className="hub-logout-btn" onClick={handleLogout}>
          <LogOut size={13} /> 로그아웃
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: ProtectedRoute.jsx 작성**

```jsx
// src/components/shared/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom'
import { getCookie } from '../../lib/auth.js'

export default function ProtectedRoute({ children }) {
  return getCookie() ? children : <Navigate to="/login" replace />
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/shared/
git commit -m "feat: add AppHeader and ProtectedRoute shared components"
```

---

## Task 8: Mailer 컴포넌트 이동 + MailerPage 생성

**Files:**
- Move: `src/components/*.jsx` → `src/components/mailer/*.jsx` (5개 파일)
- Create: `src/pages/MailerPage.jsx`

- [ ] **Step 1: mailer 서브디렉터리로 파일 이동**

```bash
mkdir -p src/components/mailer
mv src/components/JobCard.jsx src/components/mailer/JobCard.jsx
mv src/components/JobModal.jsx src/components/mailer/JobModal.jsx
mv src/components/SenderPage.jsx src/components/mailer/SenderPage.jsx
mv src/components/SenderModal.jsx src/components/mailer/SenderModal.jsx
mv src/components/TagInput.jsx src/components/mailer/TagInput.jsx
```

- [ ] **Step 2: JobModal.jsx import 경로 수정**

`src/components/mailer/JobModal.jsx` 에서:
```js
// 변경 전
import TagInput from './TagInput.jsx'
import { uploadFile, deleteFile } from '../lib/storage.js'

// 변경 후
import TagInput from './TagInput.jsx'
import { uploadFile, deleteFile } from '../../lib/storage.js'
```

- [ ] **Step 3: MailerPage.jsx 생성**

현재 `src/App.jsx`의 인증 후 UI(jobs/senders 영역)를 그대로 이식. props로 `password`를 받는 대신 `useOutletContext` 사용.

```jsx
// src/pages/MailerPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { getJobs, createJob, updateJob, deleteJob, reorderJobs, getSenders, createSender, deleteSender } from '../lib/api/mailer.js'
import { getCookie, setCookie, clearCookie } from '../lib/auth.js'
import JobCard from '../components/mailer/JobCard.jsx'
import JobModal from '../components/mailer/JobModal.jsx'
import SenderPage from '../components/mailer/SenderPage.jsx'
import SenderModal from '../components/mailer/SenderModal.jsx'
import AppHeader from '../components/shared/AppHeader.jsx'

export default function MailerPage() {
  const password = getCookie()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editJob, setEditJob] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [page, setPage] = useState('jobs')
  const [senders, setSenders] = useState([])
  const [showSenderModal, setShowSenderModal] = useState(false)
  const pollRef = useRef(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const refreshJobs = useCallback(async () => {
    try {
      const data = await getJobs(password)
      setJobs(data.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') clearCookie()
    }
  }, [password])

  const loadSenders = useCallback(async () => {
    try { setSenders(await getSenders(password)) } catch {}
  }, [password])

  useEffect(() => {
    refreshJobs()
    loadSenders()
    pollRef.current = setInterval(refreshJobs, 60_000)
    return () => clearInterval(pollRef.current)
  }, [])

  const handleCreate = async (formData) => {
    setLoading(true)
    try {
      const job = await createJob(formData, password)
      setJobs(prev => [job, ...prev])
      setShowModal(false)
    } finally { setLoading(false) }
  }

  const handleUpdate = async (id, patch) => {
    const job = await updateJob(id, patch, password)
    setJobs(prev => prev.map(j => j.id === id ? job : j))
    setEditJob(null)
    setShowModal(false)
  }

  const handleDelete = async (id) => {
    await deleteJob(id, password)
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  const handleResetCount = async (id) => {
    if (!confirm('순번을 0으로 초기화할까요?')) return
    const job = await updateJob(id, { send_count: 0 }, password)
    setJobs(prev => prev.map(j => j.id === id ? job : j))
  }

  const handleDuplicate = async (job) => {
    const { name, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments } = job
    const match = name.match(/^\[(\d+)\] (.+)$/)
    const newName = match ? `[${Number(match[1]) + 1}] ${match[2]}` : `[0] ${name}`
    const newJob = await createJob({ name: newName, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments }, password)
    setJobs(prev => [newJob, ...prev])
  }

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    setJobs(prev => {
      const oldIndex = prev.findIndex(j => j.id === active.id)
      const newIndex = prev.findIndex(j => j.id === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      reorderJobs(reordered.map(j => j.id), password)
      return reordered
    })
  }

  const handleDeleteSelected = async () => {
    await Promise.all([...selectedIds].map(id => deleteJob(id, password)))
    setJobs(prev => prev.filter(j => !selectedIds.has(j.id)))
    setSelectedIds(new Set())
  }

  const handleCreateSender = async (data) => {
    const sender = await createSender(data, password)
    setSenders(prev => [...prev, sender])
    setShowSenderModal(false)
  }

  const handleDeleteSender = async (id) => {
    if (!confirm('발신 계정을 삭제할까요?')) return
    await deleteSender(id, password)
    setSenders(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="app">
      <AppHeader toolName="Mailer">
        {page === 'jobs' ? (
          <button className="app-new-btn" onClick={() => { setEditJob(null); setShowModal(true) }}>
            <Plus size={14} /> 새 작업
          </button>
        ) : (
          <button className="app-new-btn" onClick={() => setShowSenderModal(true)}>
            <Plus size={14} /> 계정 추가
          </button>
        )}
      </AppHeader>

      <nav className="nav-tabs" style={{ padding: '0 24px' }}>
        <button className={`nav-tab${page === 'jobs' ? ' active' : ''}`} onClick={() => setPage('jobs')}>스케줄</button>
        <button className={`nav-tab${page === 'senders' ? ' active' : ''}`} onClick={() => setPage('senders')}>발신 계정</button>
      </nav>

      {page === 'jobs' ? (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
              <div className="job-list">
                {jobs.length > 0 && (
                  <div className="bulk-bar">
                    <label className="bulk-select-all">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === jobs.length}
                        onChange={e => setSelectedIds(e.target.checked ? new Set(jobs.map(j => j.id)) : new Set())}
                      />
                      전체 선택
                    </label>
                    {selectedIds.size > 0 && (
                      <button className="bulk-delete-btn" onClick={handleDeleteSelected}>
                        <Trash2 size={12} /> {selectedIds.size}개 삭제
                      </button>
                    )}
                  </div>
                )}
                {jobs.length === 0 ? (
                  <p className="job-empty">작업이 없습니다. 새 작업을 만들어보세요.</p>
                ) : (
                  jobs.map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      senders={senders}
                      selected={selectedIds.has(job.id)}
                      onSelect={checked => setSelectedIds(prev => {
                        const s = new Set(prev)
                        checked ? s.add(job.id) : s.delete(job.id)
                        return s
                      })}
                      onToggle={() => handleUpdate(job.id, { is_active: !job.is_active })}
                      onEdit={() => { setEditJob(job); setShowModal(true) }}
                      onDuplicate={() => handleDuplicate(job)}
                      onDelete={() => handleDelete(job.id)}
                      onResetCount={() => handleResetCount(job.id)}
                    />
                  ))
                )}
              </div>
            </SortableContext>
          </DndContext>

          {showModal && (
            <JobModal
              job={editJob}
              senders={senders}
              onSubmit={editJob ? (data) => handleUpdate(editJob.id, data) : handleCreate}
              onClose={() => { setShowModal(false); setEditJob(null) }}
              loading={loading}
            />
          )}
        </>
      ) : (
        <SenderPage senders={senders} onDelete={handleDeleteSender} />
      )}

      {showSenderModal && (
        <SenderModal
          onSubmit={handleCreateSender}
          onClose={() => setShowSenderModal(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/mailer/ src/pages/MailerPage.jsx
git commit -m "feat: move mailer components and create MailerPage"
```

---

## Task 9: LoginPage & HubPage

**Files:**
- Create: `src/pages/LoginPage.jsx`
- Create: `src/pages/HubPage.jsx`

- [ ] **Step 1: LoginPage.jsx 작성**

```jsx
// src/pages/LoginPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getJobs } from '../lib/api/mailer.js'
import { setCookie, getCookie } from '../lib/auth.js'

export default function LoginPage() {
  const [pwInput, setPwInput] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  if (getCookie()) {
    navigate('/', { replace: true })
    return null
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await getJobs(pwInput)
      setCookie(pwInput)
      navigate('/')
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') setError('비밀번호가 틀렸습니다.')
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
```

- [ ] **Step 2: HubPage.jsx 작성**

```jsx
// src/pages/HubPage.jsx
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { clearCookie } from '../lib/auth.js'

const TOOLS = [
  {
    id: 'mailer',
    icon: '📧',
    name: 'Mailer',
    description: '메일 발송 스케줄 관리',
    path: '/mailer',
    active: true,
  },
  {
    id: 'grafana',
    icon: '📊',
    name: 'Grafana 리포트',
    description: '모니터링 리포트 생성',
    path: '/grafana',
    active: false,
  },
  {
    id: 'chatbot',
    icon: '🤖',
    name: '챗봇 모니터링',
    description: '챗봇 활성화 현황 추적',
    path: '/chatbot',
    active: false,
  },
]

export default function HubPage() {
  const navigate = useNavigate()

  const handleLogout = () => {
    clearCookie()
    navigate('/login')
  }

  return (
    <div className="hub-wrapper">
      <header className="hub-header">
        <span className="hub-title">CS SmartHub</span>
        <button className="hub-logout-btn" onClick={handleLogout}>
          <LogOut size={13} /> 로그아웃
        </button>
      </header>

      <main className="hub-main">
        <p className="hub-subtitle">어떤 툴을 사용할까요?</p>
        <div className="hub-grid">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              className={`hub-card${tool.active ? '' : ' hub-card-disabled'}`}
              onClick={() => tool.active && navigate(tool.path)}
              disabled={!tool.active}
            >
              {!tool.active && <span className="hub-badge">준비 중</span>}
              <span className="hub-card-icon">{tool.icon}</span>
              <span className="hub-card-name">{tool.name}</span>
              <span className="hub-card-desc">{tool.description}</span>
            </button>
          ))}
          <div className="hub-card hub-card-empty">
            <span className="hub-card-icon">＋</span>
            <span className="hub-card-name" style={{ color: '#404050' }}>추가 예정</span>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/pages/LoginPage.jsx src/pages/HubPage.jsx
git commit -m "feat: add LoginPage and HubPage"
```

---

## Task 10: Placeholder 페이지

**Files:**
- Create: `src/pages/GrafanaPage.jsx`
- Create: `src/pages/ChatbotPage.jsx`

- [ ] **Step 1: GrafanaPage.jsx 작성**

```jsx
// src/pages/GrafanaPage.jsx
import AppHeader from '../components/shared/AppHeader.jsx'

export default function GrafanaPage() {
  return (
    <div className="app">
      <AppHeader toolName="Grafana 리포트" />
      <div className="job-empty" style={{ marginTop: '80px' }}>
        🚧 준비 중입니다.
      </div>
    </div>
  )
}
```

- [ ] **Step 2: ChatbotPage.jsx 작성**

```jsx
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
```

- [ ] **Step 3: 커밋**

```bash
git add src/pages/GrafanaPage.jsx src/pages/ChatbotPage.jsx
git commit -m "feat: add placeholder pages for grafana and chatbot tools"
```

---

## Task 11: App.jsx — React Router 설정

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: App.jsx를 React Router 라우터로 교체**

기존 App.jsx를 완전히 교체한다. 기존 로직은 각 Page 파일로 분산됨.

```jsx
// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import HubPage from './pages/HubPage.jsx'
import MailerPage from './pages/MailerPage.jsx'
import GrafanaPage from './pages/GrafanaPage.jsx'
import ChatbotPage from './pages/ChatbotPage.jsx'
import ProtectedRoute from './components/shared/ProtectedRoute.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><HubPage /></ProtectedRoute>} />
        <Route path="/mailer" element={<ProtectedRoute><MailerPage /></ProtectedRoute>} />
        <Route path="/grafana" element={<ProtectedRoute><GrafanaPage /></ProtectedRoute>} />
        <Route path="/chatbot" element={<ProtectedRoute><ChatbotPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/App.jsx
git commit -m "feat: wire up react router with protected routes"
```

---

## Task 12: CSS — 허브 & 공통 헤더 스타일

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: src/index.css 하단에 허브 스타일 추가**

기존 CSS는 그대로 유지하고 아래 내용을 파일 끝에 추가한다.

```css
/* ── CS SmartHub 허브 홈 ── */
.hub-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0d0d14;
}

.hub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  height: 56px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.hub-title {
  font-size: 16px;
  font-weight: 700;
  color: #f0f0f0;
  letter-spacing: -0.3px;
}

.hub-main {
  flex: 1;
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px;
  width: 100%;
}

.hub-subtitle {
  font-size: 18px;
  font-weight: 600;
  color: #c8c8d8;
  margin: 0 0 28px;
}

.hub-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.hub-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 24px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(157,143,252,0.15);
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
  color: inherit;
}

.hub-card:hover:not(.hub-card-disabled):not(.hub-card-empty) {
  border-color: rgba(157,143,252,0.45);
  background: rgba(157,143,252,0.06);
}

.hub-card-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hub-card-empty {
  border-style: dashed;
  cursor: default;
  opacity: 0.3;
}

.hub-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 20px;
  background: rgba(255,255,255,0.06);
  color: #808090;
  border: 1px solid rgba(255,255,255,0.08);
}

.hub-card-icon {
  font-size: 28px;
  margin-bottom: 4px;
}

.hub-card-name {
  font-size: 15px;
  font-weight: 600;
  color: #e8e8f0;
}

.hub-card-desc {
  font-size: 12px;
  color: #606070;
}

/* ── 툴 내부 공통 헤더 추가 스타일 ── */
.hub-back-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: #7070a0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: color 0.15s;
}

.hub-back-btn:hover {
  color: #a0a0c0;
}

.hub-divider {
  color: rgba(255,255,255,0.12);
  font-size: 14px;
}

.hub-logout-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #606070;
  background: none;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.hub-logout-btn:hover {
  color: #a0a0c0;
  border-color: rgba(255,255,255,0.15);
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/index.css
git commit -m "feat: add hub home and shared header styles"
```

---

## Task 13: Vite 프록시 설정 & 검증

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: vite.config.js에 개발 서버 프록시 추가**

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: [],
  },
})
```

- [ ] **Step 2: 전체 동작 확인**

터미널 1:
```bash
node server/index.js
```
Expected: `CS SmartHub server running on :3001`

터미널 2:
```bash
npm run dev:client
```
Expected: Vite dev server on `http://localhost:5173`

브라우저에서 `http://localhost:5173` 접속:
- `/login` 페이지 표시 확인
- 비밀번호 입력 후 허브 홈(`/`) 이동 확인
- 툴 카드 클릭 후 `/mailer` 이동 확인
- `← CS SmartHub` 버튼으로 허브 홈 복귀 확인

또는 `npm run dev` 로 concurrently 실행.

- [ ] **Step 3: 기존 api.js 및 App.css 삭제**

```bash
rm src/lib/api.js
rm src/App.css
```

`src/main.jsx`에서 `import './App.css'` 가 있다면 제거. (없으면 스킵)

- [ ] **Step 4: 전체 테스트 실행**

```bash
npm test
```

Expected: auth.test.js (3 passed), mailer.test.js (5 passed)

- [ ] **Step 5: 최종 커밋**

```bash
git add vite.config.js
git rm src/lib/api.js src/App.css 2>/dev/null || true
git commit -m "feat: add vite dev proxy, remove legacy files — cs-smarthub migration complete"
```

---

## 추후 툴 추가 체크리스트

새 툴 추가 시:
1. `server/routes/<tool>.js` 작성 → `server/index.js`에 `app.use('/api/<tool>', ...)` 등록
2. `src/pages/<Tool>Page.jsx` 작성
3. `src/App.jsx` 에 `<Route path="/<tool>" element={...} />` 추가
4. `src/pages/HubPage.jsx` `TOOLS` 배열에 항목 추가 (`active: true`)
