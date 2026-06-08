# Job Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 작업에 여러 파일을 첨부하고, 스케줄 발송 시마다 첨부파일이 포함되어 전송된다.

**Architecture:** 프론트엔드에서 Supabase Storage에 직접 업로드하고, 파일 경로 목록을 jobs 테이블의 JSONB 컬럼에 저장한다. Edge Function의 tick에서 Storage에서 파일을 읽어 denomailer로 첨부 전송하며, 작업 삭제 시 Storage 파일도 함께 삭제한다.

**Tech Stack:** React, Supabase Storage, Supabase JS Client, denomailer 1.6.0, Deno Edge Function

---

## Task 1: Supabase 설정 (수동 작업)

**⚠️ 이 태스크는 Supabase 대시보드에서 직접 수행해야 합니다.**

**Files:** 없음 (Supabase 대시보드 작업)

- [ ] **Step 1: Storage 버킷 생성**

  Supabase 대시보드 → Storage → New bucket
  - Name: `attachments`
  - Public: OFF

- [ ] **Step 2: Storage RLS 정책 추가**

  Storage → attachments 버킷 → Policies → New policy (For full customization)

  **INSERT (업로드) 정책:**
  ```sql
  CREATE POLICY "Allow anon upload"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'attachments');
  ```

  **SELECT (다운로드) 정책:**
  ```sql
  CREATE POLICY "Allow anon read"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'attachments');
  ```

  **DELETE 정책:**
  ```sql
  CREATE POLICY "Allow anon delete"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'attachments');
  ```

- [ ] **Step 3: jobs 테이블에 attachments 컬럼 추가**

  Supabase 대시보드 → SQL Editor → New query:

  ```sql
  ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
  ```

  실행 후 확인: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'attachments';`

---

## Task 2: 프론트엔드 - Storage 업로드 유틸리티

**Files:**
- Create: `src/lib/storage.js`
- Modify: `src/lib/api.js`

- [ ] **Step 1: Supabase JS 클라이언트 패키지 설치 확인**

  ```bash
  cat package.json | grep supabase
  ```

  없으면 설치:
  ```bash
  npm install @supabase/supabase-js
  ```

- [ ] **Step 2: .env에 Supabase URL 변수 확인**

  `.env` 파일에 아래 변수가 있는지 확인:
  ```
  VITE_SUPABASE_URL=https://enawzdqroidrhtjqhpka.supabase.co
  VITE_SUPABASE_ANON_KEY=<기존값>
  ```

  `VITE_SUPABASE_URL`이 없으면 추가.

- [ ] **Step 3: storage.js 생성**

  `src/lib/storage.js`:
  ```javascript
  // src/lib/storage.js
  import { createClient } from '@supabase/supabase-js'

  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  )

  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  export function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`${file.name}: 파일 크기가 10MB를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
    }
  }

  export async function uploadFile(folderUuid, file) {
    validateFile(file)
    const path = `${folderUuid}/${file.name}`
    const { error } = await supabase.storage
      .from('attachments')
      .upload(path, file, { upsert: true })
    if (error) throw new Error(`업로드 실패: ${error.message}`)
    return { path, name: file.name, size: file.size }
  }

  export async function deleteFile(path) {
    const { error } = await supabase.storage
      .from('attachments')
      .remove([path])
    if (error) throw new Error(`삭제 실패: ${error.message}`)
  }
  ```

- [ ] **Step 4: 커밋**

  ```bash
  git add src/lib/storage.js
  git commit -m "feat: add Supabase Storage upload utility"
  ```

---

## Task 3: 프론트엔드 - JobModal 첨부파일 UI

**Files:**
- Modify: `src/components/JobModal.jsx`

- [ ] **Step 1: JobModal에 attachment 상태 및 업로드 핸들러 추가**

  `src/components/JobModal.jsx` 상단 import 추가 및 상태 추가:

  ```javascript
  import { useState, useRef } from 'react'
  import { v4 as uuidv4 } from 'uuid'  // 없으면 아래 crypto 방식 사용
  import TagInput from './TagInput.jsx'
  import { uploadFile, deleteFile, validateFile } from '../lib/storage.js'
  ```

  > uuid 패키지 없이 crypto API 사용: `const folderUuid = crypto.randomUUID()`

  컴포넌트 내 상태 추가 (기존 useState 아래에):
  ```javascript
  const [attachments, setAttachments] = useState(job?.attachments ?? [])
  const [folderUuid] = useState(() => job ? null : crypto.randomUUID())
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  ```

- [ ] **Step 2: 파일 업로드/삭제 핸들러 추가**

  `handleSubmit` 위에 추가:
  ```javascript
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files)
    e.target.value = ''
    setUploading(true)
    try {
      const folder = folderUuid ?? job.id
      const results = await Promise.all(
        files.map(file => uploadFile(folder, file).catch(err => { alert(err.message); return null }))
      )
      const uploaded = results.filter(Boolean)
      setAttachments(prev => {
        const existingNames = new Set(prev.map(a => a.name))
        return [...prev, ...uploaded.filter(a => !existingNames.has(a.name))]
      })
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveAttachment = async (attachment) => {
    try {
      await deleteFile(attachment.path)
      setAttachments(prev => prev.filter(a => a.path !== attachment.path))
    } catch (err) {
      alert(err.message)
    }
  }
  ```

- [ ] **Step 3: handleSubmit에 attachments 포함**

  ```javascript
  const handleSubmit = (e) => {
    e.preventDefault()
    const interval_minutes = intervalUnit === 'hours'
      ? Number(intervalValue) * 60
      : Number(intervalValue)
    onSubmit({ name, sender, subject, body, recipients, interval_minutes, use_index: useIndex, attachments })
  }
  ```

- [ ] **Step 4: JSX에 첨부파일 섹션 추가**

  `수신자` 필드 아래(`<div className="form-field"><label className="form-label">수신자</label>` 블록 다음)에 추가:

  ```jsx
  <div className="form-field">
    <label className="form-label">첨부파일</label>
    <div className="attachment-list">
      {attachments.map(a => (
        <div key={a.path} className="attachment-item">
          <span className="attachment-name">{a.name}</span>
          <span className="attachment-size">({(a.size / 1024 / 1024).toFixed(1)}MB)</span>
          <button type="button" className="attachment-remove" onClick={() => handleRemoveAttachment(a)}>×</button>
        </div>
      ))}
    </div>
    <input
      ref={fileInputRef}
      type="file"
      multiple
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
    <button
      type="button"
      className="attachment-add"
      onClick={() => fileInputRef.current.click()}
      disabled={uploading}
    >
      {uploading ? '업로드 중...' : '파일 추가'}
    </button>
  </div>
  ```

- [ ] **Step 5: CSS 추가**

  `src/index.css`에 추가:
  ```css
  .attachment-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .attachment-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-secondary, #f5f5f5);
    border-radius: 6px;
    font-size: 13px;
  }

  .attachment-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-size {
    color: #888;
    font-size: 12px;
    white-space: nowrap;
  }

  .attachment-remove {
    background: none;
    border: none;
    cursor: pointer;
    color: #999;
    font-size: 16px;
    padding: 0 2px;
    line-height: 1;
  }

  .attachment-remove:hover {
    color: #e53e3e;
  }

  .attachment-add {
    padding: 6px 14px;
    border: 1px dashed #ccc;
    background: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: #555;
  }

  .attachment-add:hover:not(:disabled) {
    border-color: #888;
    color: #222;
  }

  .attachment-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  ```

- [ ] **Step 6: 커밋**

  ```bash
  git add src/components/JobModal.jsx src/index.css
  git commit -m "feat: add file attachment UI to JobModal"
  ```

---

## Task 4: Edge Function - smtp.ts 첨부파일 지원

**⚠️ 이 태스크는 Supabase 대시보드 Edge Function 편집기에서 수행합니다.**

**Files:**
- Modify: `supabase/functions/mailer/smtp.ts`

- [ ] **Step 1: smtp.ts 전체 교체**

  Supabase 대시보드 → Edge Functions → mailer → smtp.ts를 아래 내용으로 교체:

  ```typescript
  // supabase/functions/mailer/smtp.ts
  import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts"
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

  interface Attachment {
    path: string
    name: string
    size: number
  }

  interface SendOptions {
    sender: "gmail" | "ms"
    to: string
    subject: string
    body: string
    attachments?: Attachment[]
  }

  async function fetchAttachment(path: string): Promise<{ content: Uint8Array; contentType: string }> {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )
    const { data, error } = await supabase.storage.from("attachments").download(path)
    if (error || !data) throw new Error(`첨부파일 다운로드 실패: ${path}`)
    const buffer = await data.arrayBuffer()
    return { content: new Uint8Array(buffer), contentType: data.type || "application/octet-stream" }
  }

  export async function sendMail(opts: SendOptions): Promise<void> {
    const isGmail = opts.sender === "gmail"
    const user = isGmail
      ? Deno.env.get("GMAIL_USER")!
      : Deno.env.get("MS_USER")!
    const password = isGmail
      ? Deno.env.get("GMAIL_APP_PASSWORD")!
      : Deno.env.get("MS_APP_PASSWORD")!
    const hostname = isGmail ? "smtp.gmail.com" : "smtp-mail.outlook.com"
    const port = isGmail ? 465 : 587
    const tls = isGmail ? true : false

    const client = new SMTPClient({
      connection: { hostname, port, tls, auth: { username: user, password } },
    })

    const attachments = await Promise.all(
      (opts.attachments ?? []).map(async (a) => {
        const { content, contentType } = await fetchAttachment(a.path)
        return { filename: a.name, content, contentType }
      })
    )

    try {
      await client.send({
        from: user,
        to: opts.to,
        subject: opts.subject,
        content: opts.body,
        ...(attachments.length > 0 ? { attachments } : {}),
      })
    } finally {
      await client.close()
    }
  }
  ```

- [ ] **Step 2: Deploy 버튼 클릭**

---

## Task 5: Edge Function - index.ts 삭제 시 Storage 파일 정리

**⚠️ 이 태스크는 Supabase 대시보드 Edge Function 편집기에서 수행합니다.**

**Files:**
- Modify: `supabase/functions/mailer/index.ts`

- [ ] **Step 1: index.ts DELETE 핸들러 수정**

  기존 DELETE 핸들러:
  ```typescript
  // DELETE ?id= — 작업 삭제
  if (req.method === "DELETE") {
    if (!id) return json({ error: "id required" }, 400)
    await deleteJob(id)
    return json({ success: true })
  }
  ```

  아래로 교체:
  ```typescript
  // DELETE ?id= — 작업 삭제
  if (req.method === "DELETE") {
    if (!id) return json({ error: "id required" }, 400)

    // Storage 파일 먼저 삭제
    const job = await getJob(id)
    if (job?.attachments?.length) {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2")
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      )
      const paths = job.attachments.map((a: { path: string }) => a.path)
      await supabase.storage.from("attachments").remove(paths)
    }

    await deleteJob(id)
    return json({ success: true })
  }
  ```

- [ ] **Step 2: db.ts에 getJob 함수 추가**

  `supabase/functions/mailer/db.ts`를 확인하여 `getJob(id)` 함수가 없으면 추가:

  ```typescript
  export async function getJob(id: string) {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single()
    if (error) throw error
    return data
  }
  ```

  그리고 index.ts 상단 import에 `getJob` 추가:
  ```typescript
  import { listJobs, createJob, updateJob, deleteJob, getJob, getDueJobs, markSent } from "./db.ts"
  ```

- [ ] **Step 3: Deploy 버튼 클릭**

---

## Task 6: 프론트엔드 배포

**Files:** 없음 (git push)

- [ ] **Step 1: 변경사항 확인**

  ```bash
  git status
  ```

- [ ] **Step 2: 미커밋 파일 커밋 후 push**

  ```bash
  git add -A
  git push origin main
  ```

---

## Self-Review

**Spec coverage:**
- ✅ 여러 파일 첨부 (Task 3 - multiple input)
- ✅ 10MB 제한 (Task 2 - validateFile)
- ✅ 작업 삭제 시 Storage 파일 삭제 (Task 5)
- ✅ 스케줄 발송 시 첨부 전송 (Task 4 - fetchAttachment)
- ✅ 수정 시 기존 첨부파일 표시 (Task 3 - useState(job?.attachments))

**Notes:**
- db.ts를 아직 보지 못했으므로 Task 5 Step 2의 getJob 구현은 기존 패턴에 맞게 조정 필요
- denomailer의 정확한 attachment 타입은 실제 실행 시 에러가 나면 조정 필요
