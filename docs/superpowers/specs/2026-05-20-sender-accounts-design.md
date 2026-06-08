# 발신 계정 관리 기능 설계

## 개요

Gmail 계정(이메일 + 앱 비밀번호)을 DB에 등록해두고, 스케줄 생성/수정 시 발신 계정을 드롭다운으로 선택한다. 기존 `sender` enum 라디오 버튼을 대체한다. 메일 내용·제목·수신자·첨부파일·순번·발송 간격 등 다른 기능은 변경하지 않는다.

---

## DB 변경

### 신규 테이블: `sender_accounts`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK default gen_random_uuid() | |
| email | text not null | Gmail 주소 |
| app_password | text not null | 앱 비밀번호 (평문) |
| created_at | timestamptz default now() | |

### `mail_jobs` 테이블 변경

- `sender_account_id` uuid nullable FK → `sender_accounts.id` 추가
- 기존 `sender` 컬럼 유지 (데이터 보존, 하위 호환)

기존 job의 `sender_account_id`는 null로 시작 — 사용자가 직접 수정해서 계정을 선택한다.

---

## Edge Function (`mailer`) 변경

### 신규 엔드포인트 (APP_PASSWORD 인증 필요)

| 메서드 | 경로 | 동작 |
|--------|------|------|
| GET | `?resource=senders` | 계정 목록 반환 (app_password 마스킹) |
| POST | `?resource=senders` | 계정 추가 |
| DELETE | `?resource=senders&id=` | 계정 삭제 |

### tick 핸들러

```
sender_account_id 있음 → sender_accounts에서 email + app_password 조회 → nodemailer
sender_account_id 없음 → 기존 sender enum + 환경변수 방식 (하위 호환 fallback)
```

### `db.ts` 추가

- `getSenderAccounts()` — 목록 조회 (app_password 마스킹)
- `createSenderAccount({ email, app_password })` — 추가
- `deleteSenderAccount(id)` — 삭제
- `getSenderAccountById(id)` — tick에서 자격증명 조회 (app_password 포함)
- `MailJob` 인터페이스에 `sender_account_id: string | null` 추가

---

## 프론트엔드 변경

### App.jsx

- `page` state (`'jobs' | 'senders'`) 추가
- `senders` 목록 state 추가 (로그인 후 load, JobModal에 전달)
- 헤더에 "스케줄 | 발신 계정" 탭

### 신규: `SenderPage.jsx`

- 등록된 계정 카드 리스트 (이메일, 앱 비밀번호 `••••••••`)
- "계정 추가" 버튼 → `SenderModal` 열기
- 계정 삭제 버튼

### 신규: `SenderModal.jsx`

- 이메일 입력
- 앱 비밀번호 입력 + 보기/숨기기 토글
- 저장 / 취소

### `src/lib/api.js`

- `getSenders(pw)`, `createSender(data, pw)`, `deleteSender(id, pw)` 추가

### `JobModal.jsx`

- 기존 `sender` 라디오(Gmail/Outlook) → 등록 계정 드롭다운으로 교체
- `sender_account_id` 저장

### `JobCard.jsx`

- Gmail/Outlook 배지 → 선택된 계정 이메일 주소 표시
- `sender_account_id` 없는 기존 job은 기존 배지 유지 (하위 호환)

---

## 데이터 흐름

```
[SenderPage] → POST ?resource=senders → DB insert sender_accounts
[JobModal]   → GET ?resource=senders → 드롭다운 → sender_account_id 선택 → PATCH job
[tick]       → sender_account_id 있으면 DB 계정, 없으면 env var fallback
```

---

## 변경하지 않는 것

- 메일 제목·본문·수신자·첨부파일·순번(use_index)·발송 간격 관련 모든 로직
- 기존 CRUD 엔드포인트 구조

---

## 범위 외

- Outlook(MS) 계정 등록 지원
- Supabase Vault 암호화
