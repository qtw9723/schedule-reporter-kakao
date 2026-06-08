# Sender Accounts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gmail 발신 계정(이메일+앱비밀번호)을 DB에 등록하고, 스케줄 생성·수정 시 드롭다운으로 선택한다.

**Architecture:** `sender_accounts` 테이블 신규 생성 → `mail_jobs`에 `sender_account_id` FK 추가 → Edge Function에 senders CRUD 엔드포인트 추가 → 프론트엔드에 발신 계정 탭·컴포넌트 추가, JobModal 드롭다운 교체.

**Tech Stack:** Supabase PostgreSQL, Deno Edge Functions, React + Vite, nodemailer

---

### Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/20260520000000_add_sender_accounts.sql`

- [ ] 마이그레이션 파일 생성

```sql
-- sender_accounts 테이블
CREATE TABLE sender_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  app_password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- mail_jobs에 FK 추가
ALTER TABLE mail_jobs
ADD COLUMN IF NOT EXISTS sender_account_id UUID
  REFERENCES sender_accounts(id) ON DELETE SET NULL;
```

- [ ] Supabase에 적용

```bash
supabase db push --project-ref enawzdqroidrhtjqhpka
```

Expected: `Applying migration 20260520000000_add_sender_accounts.sql... done`

- [ ] 커밋

```bash
git add supabase/migrations/
git commit -m "feat: add sender_accounts table and sender_account_id fk"
```

---

### Task 2: Edge Function — db.ts

**Files:**
- Modify: `supabase/functions/mailer/db.ts`

- [ ] `MailJob` 인터페이스에 `sender_account_id` 추가

```typescript
export interface MailJob {
  id: string
  name: string
  subject: string
  body: string
  recipients: string[]
  sender: "gmail" | "ms"
  sender_account_id: string | null   // 추가
  interval_minutes: number
  is_active: boolean
  last_sent_at: string | null
  send_count: number
  use_index: boolean
  attachments: { path: string; name: string; size: number }[]
  created_at: string
}
```

- [ ] SenderAccount 인터페이스 및 CRUD 함수 추가 (파일 맨 아래에 추가)

```typescript
export interface SenderAccount {
  id: string
  email: string
  app_password: string
  created_at: string
}

export async function getSenderAccounts(): Promise<Omit<SenderAccount, 'app_password'>[]> {
  const db = getDb()
  const { data, error } = await db
    .from("sender_accounts")
    .select("id, email, created_at")
    .order("created_at", { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createSenderAccount(
  account: Pick<SenderAccount, 'email' | 'app_password'>
): Promise<Omit<SenderAccount, 'app_password'>> {
  const db = getDb()
  const { data, error } = await db
    .from("sender_accounts")
    .insert(account)
    .select("id, email, created_at")
    .single()
  if (error) throw error
  return data
}

export async function deleteSenderAccount(id: string): Promise<void> {
  const db = getDb()
  const { error } = await db.from("sender_accounts").delete().eq("id", id)
  if (error) throw error
}

export async function getSenderAccountById(id: string): Promise<SenderAccount | null> {
  const db = getDb()
  const { data, error } = await db
    .from("sender_accounts")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data
}
```

---

### Task 3: Edge Function — smtp.ts

**Files:**
- Modify: `supabase/functions/mailer/smtp.ts`

- [ ] `SendOptions`에 직접 자격증명 필드 추가

`sender?: "gmail" | "ms"` 는 유지하고 `senderEmail`, `senderPassword` 추가:

```typescript
interface SendOptions {
  sender?: "gmail" | "ms"
  senderEmail?: string
  senderPassword?: string
  to: string
  subject: string
  body: string
  attachments?: Attachment[]
}
```

- [ ] `sendMail` 함수에서 자격증명 결정 로직 수정

기존 `const isGmail = opts.sender === "gmail"` 블록을 아래로 교체:

```typescript
export async function sendMail(opts: SendOptions): Promise<void> {
  const isGmail = opts.senderEmail ? true : opts.sender === "gmail"
  const user = opts.senderEmail ?? (isGmail ? Deno.env.get("GMAIL_USER")! : Deno.env.get("MS_USER")!)
  const password = opts.senderPassword ?? (isGmail ? Deno.env.get("GMAIL_APP_PASSWORD")! : Deno.env.get("MS_APP_PASSWORD")!)

  const transporter = nodemailer.createTransport({
    host: isGmail ? "smtp.gmail.com" : "smtp-mail.outlook.com",
    port: isGmail ? 465 : 587,
    secure: isGmail,
    auth: { user, pass: password },
  })
  // ... 이하 동일
```

---

### Task 4: Edge Function — index.ts

**Files:**
- Modify: `supabase/functions/mailer/index.ts`

- [ ] import에 sender 함수들 추가

```typescript
import {
  listJobs, createJob, updateJob, deleteJob,
  getJob, getDueJobs, markSent,
  getSenderAccounts, createSenderAccount, deleteSenderAccount, getSenderAccountById
} from "./db.ts"
```

- [ ] `resource` 파라미터 추가 및 senders 엔드포인트 삽입

`const id = url.searchParams.get("id")` 다음 줄에:

```typescript
const resource = url.searchParams.get("resource")
```

`if (!checkAppPassword(req)) return json({ error: "unauthorized" }, 401)` 바로 다음에:

```typescript
// Senders CRUD
if (resource === "senders") {
  if (req.method === "GET") {
    return json(await getSenderAccounts())
  }
  if (req.method === "POST") {
    const body = await req.json()
    return json(await createSenderAccount(body), 201)
  }
  if (req.method === "DELETE") {
    if (!id) return json({ error: "id required" }, 400)
    await deleteSenderAccount(id)
    return json({ success: true })
  }
}
```

- [ ] tick 핸들러에서 sender_account_id 분기 처리

기존 tick의 `sendMail` 호출 부분을 아래로 교체:

```typescript
jobs.map(async (job) => {
  const subject = job.use_index ? `[${job.send_count + 1}] ${job.subject}` : job.subject

  const sendOpts = job.sender_account_id
    ? await (async () => {
        const account = await getSenderAccountById(job.sender_account_id!)
        if (!account) throw new Error(`Sender account not found: ${job.sender_account_id}`)
        return { senderEmail: account.email, senderPassword: account.app_password }
      })()
    : { sender: job.sender }

  for (const recipient of job.recipients) {
    await sendMail({ ...sendOpts, to: recipient, subject, body: job.body, attachments: job.attachments })
  }
  await markSent(job.id, job.send_count)
})
```

- [ ] Edge Function 배포

```bash
supabase functions deploy mailer --project-ref enawzdqroidrhtjqhpka
```

- [ ] 커밋

```bash
git add supabase/functions/mailer/
git commit -m "feat: sender accounts crud endpoints and tick fallback"
```

---

### Task 5: Frontend — api.js

**Files:**
- Modify: `src/lib/api.js`

- [ ] senders API 함수 추가 (파일 맨 아래)

```javascript
export const getSenders = (pw) => request('GET', '?resource=senders', null, pw)
export const createSender = (data, pw) => request('POST', '?resource=senders', data, pw)
export const deleteSender = (id, pw) => request('DELETE', `?resource=senders&id=${id}`, null, pw)
```

단, 기존 `request` 함수의 경로 생성 방식 확인 필요. 현재 `BASE + path` 구조이므로:
- `getSenders`: `BASE + '?resource=senders'`
- `deleteSender`: `BASE + '?resource=senders&id=${id}'`

---

### Task 6: SenderModal 컴포넌트

**Files:**
- Create: `src/components/SenderModal.jsx`

- [ ] 파일 생성

```jsx
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
```

---

### Task 7: SenderPage 컴포넌트

**Files:**
- Create: `src/components/SenderPage.jsx`

- [ ] 파일 생성

```jsx
import { Trash2 } from 'lucide-react'

export default function SenderPage({ senders, onDelete }) {
  return (
    <div className="sender-page">
      {senders.length === 0 ? (
        <p className="job-empty">등록된 발신 계정이 없습니다.</p>
      ) : (
        <div className="sender-list">
          {senders.map(s => (
            <div key={s.id} className="sender-card">
              <div className="sender-icon">G</div>
              <div className="sender-info">
                <div className="sender-email">{s.email}</div>
                <div className="sender-meta">앱 비밀번호 ••••••••••••••••</div>
              </div>
              <button
                className="btn btn-delete"
                onClick={() => onDelete(s.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

### Task 8: App.jsx — 탭·senders 상태·핸들러

**Files:**
- Modify: `src/App.jsx`

- [ ] import 추가

```javascript
import { getSenders, createSender, deleteSender } from './lib/api.js'
import SenderPage from './components/SenderPage.jsx'
import SenderModal from './components/SenderModal.jsx'
```

- [ ] state 추가 (`password` state 선언 바로 다음)

```javascript
const [page, setPage] = useState('jobs')
const [senders, setSenders] = useState([])
const [showSenderModal, setShowSenderModal] = useState(false)
```

- [ ] `loadSenders` 함수 추가 (`refreshJobs` 정의 바로 다음)

```javascript
const loadSenders = useCallback(async (pw) => {
  try {
    const data = await getSenders(pw)
    setSenders(data)
  } catch (e) {
    console.error('senders load failed:', e)
  }
}, [])
```

- [ ] 초기 useEffect에서 `loadSenders` 호출 추가

기존:
```javascript
refreshJobs(pw).then(ok => {
  if (ok) {
    setAuthenticated(true)
    startPolling(pw)
  }
})
```
→ 변경:
```javascript
refreshJobs(pw).then(ok => {
  if (ok) {
    setAuthenticated(true)
    startPolling(pw)
    loadSenders(pw)
  }
})
```

- [ ] `handleLogin` 에서도 `loadSenders` 호출 추가

```javascript
setAuthenticated(true)
setCookie(pwInput)
startPolling(pwInput)
loadSenders(pwInput)   // 추가
```

- [ ] sender 핸들러 추가 (`handleDeleteSelected` 다음)

```javascript
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
```

- [ ] 헤더 교체: 탭 + 동적 버튼

기존:
```jsx
<header className="app-header">
  <span className="app-title">Mailer</span>
  <button className="app-new-btn" onClick={() => { setEditJob(null); setShowModal(true) }}>
    <Plus size={14} /> 새 작업
  </button>
</header>
```
→ 변경:
```jsx
<header className="app-header">
  <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
    <span className="app-title">Mailer</span>
    <nav className="nav-tabs">
      <button className={`nav-tab${page === 'jobs' ? ' active' : ''}`} onClick={() => setPage('jobs')}>스케줄</button>
      <button className={`nav-tab${page === 'senders' ? ' active' : ''}`} onClick={() => setPage('senders')}>발신 계정</button>
    </nav>
  </div>
  {page === 'jobs' ? (
    <button className="app-new-btn" onClick={() => { setEditJob(null); setShowModal(true) }}>
      <Plus size={14} /> 새 작업
    </button>
  ) : (
    <button className="app-new-btn" onClick={() => setShowSenderModal(true)}>
      <Plus size={14} /> 계정 추가
    </button>
  )}
</header>
```

- [ ] 메인 컨텐츠 분기 추가

기존 `<DndContext ...>` 블록 전체를 조건부로 감싸기:

```jsx
{page === 'jobs' ? (
  <>
    <DndContext ...>
      ...기존 job-list 전체...
    </DndContext>
    {showModal && (
      <JobModal
        job={editJob}
        senders={senders}
        onSubmit={...}
        onClose={...}
        loading={loading}
      />
    )}
  </>
) : (
  <SenderPage
    senders={senders}
    onDelete={handleDeleteSender}
  />
)}
{showSenderModal && (
  <SenderModal
    onSubmit={handleCreateSender}
    onClose={() => setShowSenderModal(false)}
  />
)}
```

---

### Task 9: JobModal.jsx — 발신자 라디오 → 드롭다운

**Files:**
- Modify: `src/components/JobModal.jsx`

- [ ] props에 `senders` 추가, `sender` state → `senderAccountId` state로 교체

```javascript
export default function JobModal({ job, onSubmit, onClose, loading, senders }) {
  // 기존: const [sender, setSender] = useState(job?.sender ?? 'gmail')
  const [senderAccountId, setSenderAccountId] = useState(job?.sender_account_id ?? '')
```

- [ ] 발신자 폼 필드 교체

기존 라디오 그룹:
```jsx
<div className="form-field">
  <label className="form-label">발신자</label>
  <div className="radio-group">
    ...
  </div>
</div>
```
→ 드롭다운으로 교체:
```jsx
<div className="form-field">
  <label className="form-label">발신 계정</label>
  {senders.length === 0 ? (
    <p className="form-hint" style={{ color: '#f87171' }}>
      등록된 발신 계정이 없습니다. 발신 계정 탭에서 먼저 추가해주세요.
    </p>
  ) : (
    <div className="sender-select-wrap">
      <select
        className="sender-select"
        value={senderAccountId}
        onChange={e => setSenderAccountId(e.target.value)}
        required
      >
        <option value="">계정 선택</option>
        {senders.map(s => (
          <option key={s.id} value={s.id}>{s.email}</option>
        ))}
      </select>
      <span className="sender-select-arrow">▾</span>
    </div>
  )}
</div>
```

- [ ] `handleSubmit`에서 `sender_account_id` 전달

```javascript
onSubmit({
  name,
  sender: 'gmail',
  sender_account_id: senderAccountId || null,
  subject, body, recipients, interval_minutes,
  use_index: useIndex, attachments
})
```

---

### Task 10: JobCard.jsx — 발신자 표시 업데이트

**Files:**
- Modify: `src/components/JobCard.jsx`

- [ ] props에 `senders` 추가

```javascript
export default function JobCard({ job, selected, onSelect, onToggle, onEdit, onDelete, onDuplicate, onResetCount, senders }) {
```

- [ ] 기존 Gmail/Outlook 배지 → 조건부 표시

기존:
```jsx
<span className="job-meta-item">
  <span className={`job-badge ${job.sender === 'gmail' ? 'job-badge-gmail' : 'job-badge-ms'}`}>
    {job.sender === 'gmail' ? 'Gmail' : 'Outlook'}
  </span>
</span>
```
→ 변경:
```jsx
<span className="job-meta-item">
  {job.sender_account_id && senders ? (
    <span style={{ color: '#a0a0b0', fontSize: '12px' }}>
      {senders.find(s => s.id === job.sender_account_id)?.email ?? 'Gmail'}
    </span>
  ) : (
    <span className={`job-badge ${job.sender === 'gmail' ? 'job-badge-gmail' : 'job-badge-ms'}`}>
      {job.sender === 'gmail' ? 'Gmail' : 'Outlook'}
    </span>
  )}
</span>
```

- [ ] App.jsx에서 JobCard에 `senders` prop 전달

```jsx
<JobCard
  key={job.id}
  job={job}
  senders={senders}
  ...
/>
```

---

### Task 11: index.css — 스타일 추가

**Files:**
- Modify: `src/index.css`

- [ ] 파일 맨 아래에 추가

```css
/* ── 탭 네비게이션 ── */
.app-header { padding: 0 32px; height: 56px; }
.nav-tabs { display: flex; }
.nav-tab {
  padding: 0 16px; height: 56px;
  display: flex; align-items: center;
  font-size: 13px; font-weight: 500; color: #606070;
  background: none; border: none; border-bottom: 2px solid transparent;
  cursor: pointer; transition: color 150ms, border-color 150ms;
}
.nav-tab:hover { color: #a0a0b0; }
.nav-tab.active { color: #9d8ffc; border-bottom-color: #9d8ffc; }

/* ── 발신 계정 페이지 ── */
.sender-page { max-width: 860px; margin: 28px auto; padding: 0 24px; }
.sender-list { display: flex; flex-direction: column; gap: 10px; }
.sender-card {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(157,143,252,0.12);
  border-radius: 12px; padding: 16px 20px;
  display: flex; align-items: center; gap: 14px;
  transition: border-color 150ms;
}
.sender-card:hover { border-color: rgba(157,143,252,0.25); }
.sender-icon {
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(234,67,53,0.1);
  display: flex; align-items: center; justify-content: center;
  color: #f87171; font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.sender-info { flex: 1; min-width: 0; }
.sender-email { font-size: 14px; font-weight: 600; color: #e0e0f0; }
.sender-meta { font-size: 12px; color: #606070; margin-top: 2px; }

/* ── 발신자 셀렉트 ── */
.sender-select-wrap { position: relative; }
.sender-select {
  width: 100%;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(157,143,252,0.15);
  border-radius: 9px; padding: 9px 36px 9px 12px;
  font-size: 14px; color: #e2e2e2;
  appearance: none; cursor: pointer;
  font-family: inherit; outline: none;
}
.sender-select:focus { border-color: #9d8ffc; }
.sender-select-arrow {
  position: absolute; right: 12px; top: 50%;
  transform: translateY(-50%);
  pointer-events: none; color: #606070; font-size: 11px;
}

/* ── 앱 비밀번호 입력 ── */
.pw-input-wrap { position: relative; }
.pw-toggle-btn {
  position: absolute; right: 10px; top: 50%;
  transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: #606070; font-size: 11px; font-weight: 600; padding: 2px 6px;
}
.pw-toggle-btn:hover { color: #9d8ffc; }
```

---

### Task 12: 로컬 확인 및 최종 배포

- [ ] 로컬 서버 실행

```bash
npm run dev
```

- [ ] 수동 확인 체크리스트
  - [ ] "발신 계정" 탭으로 전환
  - [ ] "계정 추가" → 이메일 + 앱 비밀번호 입력 → 저장 → 카드에 표시
  - [ ] 계정 삭제
  - [ ] "스케줄" 탭 → 새 작업 → 발신 계정 드롭다운에 등록 계정 표시
  - [ ] 기존 job 카드에 Gmail 배지 유지 (sender_account_id 없는 경우)
  - [ ] 발신 계정 선택 후 저장 → 카드에 이메일 주소 표시

- [ ] 빌드 확인

```bash
npm run build
```

- [ ] 최종 커밋 및 배포

```bash
git add src/
git commit -m "feat: sender accounts management page and job modal dropdown"
git push origin main
```
