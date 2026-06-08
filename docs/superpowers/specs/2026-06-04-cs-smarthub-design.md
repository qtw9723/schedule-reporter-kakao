# CS SmartHub — 마이그레이션 설계

**날짜:** 2026-06-04  
**상태:** 승인됨

## 개요

현재 단일 Mailer 앱을 CS팀 업무 지원 툴 모음 허브(CS SmartHub)로 전환한다.
허브 홈(대문)에서 툴을 선택하는 SPA 구조이며, 툴은 계속 추가될 예정이다.

**초기 툴 목록:**
- Mailer — 메일 발송 스케줄 관리 (현재 기능)
- Grafana 리포트 — 모니터링 리포트 생성 (추후 구현)
- 챗봇 모니터링 — 챗봇 활성화 현황 추적 (추후 구현)

---

## 스택 변경

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| 프로젝트명 | mailer | cs-smarthub |
| 백엔드 | Supabase Edge Functions (Deno) | Node.js Express |
| DB 연결 | Deno용 Supabase SDK | `pg` (node-postgres) |
| 라우팅 | 없음 (단일 페이지) | React Router |
| 프론트엔드 | React + Vite + Tailwind | 동일 유지 |
| DB | Supabase PostgreSQL | 동일 유지 |

---

## 디렉터리 구조

```
cs-smarthub/
├── client/                      # 프론트엔드
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx              # React Router 설정
│       ├── pages/
│       │   ├── LoginPage.jsx    # 허브 로그인
│       │   ├── HubPage.jsx      # 대문 (툴 카드 선택)
│       │   ├── MailerPage.jsx   # 현재 App.jsx 내용
│       │   ├── GrafanaPage.jsx  # placeholder
│       │   └── ChatbotPage.jsx  # placeholder
│       ├── components/
│       │   ├── mailer/          # 현재 components/ → 이동
│       │   └── shared/          # 공통 컴포넌트 (AppHeader 등)
│       └── lib/
│           ├── api/
│           │   └── mailer.js    # 현재 api.js → 이동
│           └── auth.js          # 인증 공통 로직 (쿠키 read/write)
├── server/                      # Node.js Express 백엔드
│   ├── index.js                 # Express 앱 진입점
│   ├── db.js                    # pg 연결 (Supabase PostgreSQL)
│   └── routes/
│       ├── mailer.js            # 현재 Edge Function 로직 이식
│       ├── grafana.js           # placeholder
│       └── chatbot.js           # placeholder
├── package.json
└── .env
```

---

## 대문(Hub) 페이지

`/` 경로. 인증 후 진입하는 툴 선택 화면.

**레이아웃:**
- 상단 헤더: `CS SmartHub` 타이틀 + 로그아웃 버튼
- 서브타이틀: "어떤 툴을 사용할까요?"
- 툴 카드 그리드 (2열)

**툴 카드 구성:**
- 아이콘 + 이름 + 한 줄 설명
- 클릭 시 해당 툴 경로로 이동
- 미구현 툴은 비활성화 스타일 + "준비 중" 뱃지 (클릭 불가)

**툴 내부 헤더:**
- 좌측: `← CS SmartHub` 버튼 (허브 홈 복귀) + 구분선 + 툴 이름
- 우측: 로그아웃 버튼
- 각 툴의 기존 내부 탭/네비는 그대로 유지

---

## 인증

기존 비밀번호 방식 유지, 범위만 확장.

- 로그인 페이지(`/login`)에서 비밀번호 입력
- 인증 성공 시 쿠키 발급 (만료: 10분)
- 쿠키는 허브와 모든 툴이 공유
- 미인증 상태에서 `/mailer` 등 직접 접근 시 → `/login` 리다이렉트
- 쿠키 만료 또는 401 응답 시 전체 로그아웃 → `/login`

```
미인증 → /login
           ↓ 비밀번호 입력
         / (허브 홈)
           ↓ 카드 클릭
         /mailer | /grafana | /chatbot
```

---

## 백엔드 마이그레이션

`supabase/functions/mailer/` 의 로직을 `server/routes/mailer.js`로 이식.

**DB 연결:**
```js
// server/db.js
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
export default pool
```

**Express 라우터 구조:**
```js
// server/index.js
import express from 'express'
import mailerRouter from './routes/mailer.js'

const app = express()
app.use(express.json())
app.use('/api/mailer', mailerRouter)
// 추후: app.use('/api/grafana', grafanaRouter)
// 추후: app.use('/api/chatbot', chatbotRouter)
```

**API 경로 변경:**

| 현재 (Edge Function) | 변경 후 (Express) |
|---------------------|------------------|
| `VITE_MAILER_URL` (Supabase URL) | `/api/mailer` |
| `?resource=senders` | `/api/mailer/senders` |
| `x-app-password` 헤더 인증 | 동일 유지 |

---

## 배포

- **프론트엔드:** Vercel (현재와 동일)
- **백엔드:** Vercel Functions(Node.js runtime) 또는 Railway/Render
  - 결정 보류 — 구현 단계에서 확정
- **DB:** Supabase PostgreSQL (변경 없음)

---

## 미구현 툴 처리

Grafana 리포트, 챗봇 모니터링은 카드만 표시하고 비활성화.  
각 `GrafanaPage.jsx`, `ChatbotPage.jsx`는 "준비 중" placeholder 페이지로 생성.  
라우터에는 등록해두되 카드 클릭은 막아둠.

---

## 추후 툴 추가 시 체크리스트

1. `server/routes/<tool>.js` 추가 + `server/index.js`에 등록
2. `client/src/pages/<Tool>Page.jsx` 생성
3. `client/src/App.jsx` 라우트 추가
4. `HubPage.jsx` 툴 카드 목록에 추가
