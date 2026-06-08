# 설계 — Grafana 리포트 발송 설정 (수신자·발송 시각 UI)

> 작성일 2026-06-05. 프로젝트 `/Users/sangjun/IdeaProjects/mailer`.
> 선행: `2026-06-05-grafana-report-design.md` (리포트 툴 본체, 이미 배포 완료).

## 1. 목적

Grafana 일일 리포트의 **수신자 목록**과 **발송 시각(시 단위)**을 코드/env 수정·재배포 없이
웹 UI(`/grafana` → "설정" 탭)에서 직접 변경할 수 있게 한다. 메일러의 발송 설정 화면 패턴을 따른다.

## 2. 현재 상태와 변경점

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| 수신자 | env `GRAFANA_EMAIL_TO` (고정) | Supabase `grafana_report_settings.recipients` (UI 편집) |
| 발송 시각 | `vercel.json` cron `0 0 * * *` (KST 09:00 고정) | DB `send_hour` (KST 0–23), UI 편집 |
| 자동 발송 on/off | 없음 (항상) | DB `enabled` 토글 |
| 트리거 | Vercel Cron → `/api/grafana/cron` | Supabase pg_cron(매시간) → `/api/grafana/tick` |

env 폴백: `recipients`가 비어 있으면 `GRAFANA_EMAIL_TO`를 사용(이행기 안전장치).

## 3. 데이터 모델

새 테이블 `grafana_report_settings` — **싱글톤(단일 행, id=1)**. 일일 운영 리포트 1종이라 다중 스케줄은 두지 않는다(YAGNI).

```sql
CREATE TABLE grafana_report_settings (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  recipients     TEXT[]      NOT NULL DEFAULT '{}',
  send_hour      SMALLINT    NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  last_sent_date DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO grafana_report_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
```

- `send_hour`: **KST 기준 시**. (KST = UTC+9, DST 없음)
- `last_sent_date`: 중복 발송 방지용. 발송 성공 시 KST 오늘 날짜로 기록.

## 4. 백엔드 (`server/`)

### 4.1 순수 함수 (`server/grafana/schedule.js`, 신규)
스케줄 판단을 라우터에서 분리해 단위테스트 가능하게 한다.

- `kstHour(date)` — 주어진 Date의 KST 시(0–23) 반환.
- `kstDateString(date)` — KST 기준 `YYYY-MM-DD` 문자열.
- `shouldSend(settings, now)` → `{ send: boolean, reason: string }`
  - `enabled`가 false → `{send:false, reason:'disabled'}`
  - `kstHour(now) !== settings.send_hour` → `{send:false, reason:'not-time'}`
  - `settings.last_sent_date === kstDateString(now)` → `{send:false, reason:'already-sent'}`
  - 그 외 → `{send:true, reason:'ok'}`

### 4.2 라우트 (`server/routes/grafana.js`)
- `GET /api/grafana/settings` (app_password) — 싱글톤 조회. 행 없으면 생성. `recipients`가 비면 env `GRAFANA_EMAIL_TO`를 파싱해 응답에 채워 반환(저장은 안 함).
- `PUT /api/grafana/settings` (app_password) — `{ recipients, send_hour, enabled }` 검증 후 저장.
  - `recipients`: 문자열 배열, 각 항목 trim·공백 제거. 빈 배열 허용(자동 발송 의미 없어지지만 막지 않음).
  - `send_hour`: 0–23 정수 아니면 400.
  - `enabled`: boolean.
- `GET /api/grafana/tick` (**CRON_SECRET Bearer**) — pg_cron이 매시간 호출.
  1. 설정 조회(없으면 생성).
  2. `shouldSend(settings, now)` 판단. `send=false`면 `{ sent:false, reason }` 200 반환.
  3. 발송 대상 recipients 결정(설정 우선, 비면 env 폴백). 비어 있으면 `{sent:false, reason:'no-recipients'}`.
  4. `gatherReportData → buildReport → buildEmailHtml → sendReportEmail(html, recipients)`.
  5. `last_sent_date = kstDateString(now)` 갱신. `{ sent:true, alerts }` 반환.
- 기존 `GET /api/grafana/cron`은 **제거**(tick으로 대체). `/report`(on-demand)는 유지.

### 4.3 메일 발송 (`server/grafana/email.js`)
- 시그니처 변경: `sendReportEmail(html, recipients)`.
  - `recipients`(배열)가 인자로 오면 그대로 사용. (env 파싱 책임은 라우트로 이동)
  - `from`/`pass`는 계속 env(`GRAFANA_EMAIL_FROM`/`_PASSWORD`)에서 읽음.

### 4.4 DB 접근
`server/db.js`(기존 supabase 클라이언트) 재사용. settings 조회/수정/`last_sent_date` 갱신.

## 5. 프런트 (`src/`)

### 5.1 `src/pages/GrafanaPage.jsx`
메일러처럼 `nav-tabs`로 **탭 2개**: `리포트` | `설정`.
- `리포트` 탭: 기존 리포트 뷰(요약·메트릭·로그) 그대로.
- `설정` 탭: 새 `GrafanaSettings` 컴포넌트.

### 5.2 `src/components/grafana/GrafanaSettings.jsx` (신규)
메일러 JobModal 폼 패턴 재사용:
- 수신자: 기존 `src/components/mailer/TagInput.jsx` 재사용(이메일 칩 입력).
- 발송 시각: `<select>` 0–23시(KST) — 라벨 예 "09시 (KST)".
- 자동 발송: 체크박스/토글.
- `저장` 버튼 → `updateSettings`. 저장 중 비활성, 성공 시 피드백.
- 로드 시 `getSettings`로 폼 초기화. 401 → `clearCookie` + 로그인 이동(기존 패턴).

### 5.3 `src/lib/api/grafana.js`
추가:
- `getSettings(pw)` — `GET /api/grafana/settings`.
- `updateSettings(body, pw)` — `PUT /api/grafana/settings`.

### 5.4 스타일 (`src/index.css`)
기존 `.grafana-*` + 메일러 폼/탭 클래스 재사용. 필요한 최소한의 설정 폼 스타일만 추가.

## 6. 스케줄 인프라 전환

- `vercel.json`: `crons` 배열에서 `/api/grafana/cron` 항목 **제거**(pg_cron으로 일원화, 이중 발송 방지).
- Supabase pg_cron **항목 1개 추가**(메일러 기존 cron은 건드리지 않음). 매시간 `/api/grafana/tick`을 Bearer 인증으로 호출.
  - SQL은 plan 문서에 포함. `cron.schedule('grafana-report-tick', '0 * * * *', $$ ... net.http_get(... Authorization: Bearer <CRON_SECRET>) $$)`.
  - 배포 단계에서 사용자가 Supabase SQL 에디터에서 1회 실행(CRON_SECRET 값 주입).

## 7. 테스트

- `server/grafana/schedule.test.js` (신규): `kstHour`/`kstDateString` 경계(UTC→KST 날짜 넘어가는 시각), `shouldSend` 4분기.
- `server/routes/grafana.test.js` (확장): settings GET(생성/env폴백)·PUT(검증 400·정상), tick의 skip(disabled/not-time/already-sent/no-recipients)·send 경로(client/email/db 모킹).

## 8. 영향 범위 / 비변경

- 메일러(`mail_jobs`, `/tick`, Edge Function, 기존 pg_cron) **무관·무변경**.
- Grafana `/report` on-demand 조회 동작 불변.
- env 8종 유지. `GRAFANA_EMAIL_TO`는 폴백으로만 사용(초기 이행기).

## 9. 배포 체크리스트(요약, 상세는 plan)

1. 마이그레이션 적용(테이블 생성).
2. 코드 배포(`vercel --prod`) — vercel.json cron 제거 포함.
3. Supabase SQL 에디터에서 pg_cron 항목 추가(CRON_SECRET 주입).
4. UI에서 수신자/시각 저장 → 동작 확인.
