# 설계 — Grafana 리포트 로그 적재 지연 보정 (설정 가능 오프셋)

> 작성일 2026-06-08. 프로젝트 `/Users/sangjun/IdeaProjects/mailer`.
> 배경: 일별 리포트가 "이벤트시각(@timestamp) 기준 최근 24h"를 조회하는데, 로그가 ES에 늦게 색인되면(관측 ~2h) 발송 시점에 미색인 로그를 못 세고, 그 로그는 다음날 창에도 안 들어가 영구 누락됨. (근본원인 확정: soe 4건 이벤트 06-08 07:08 KST, 실제 색인 06-08 09:09 KST, 이메일 생성 09:00 KST보다 9분 늦음.)

## 1. 목적

ES 로그 조회 시간창을 `now`가 아니라 **`now-Δ`에서 끝나게** 당겨, 늦게 색인되는 로그가 "그 로그를 포함하는 창을 조회하기 전"에 들어올 시간을 준다. Δ(`log_lag_hours`)는 설정에서 조절(기본 3시간).

## 2. 핵심 메커니즘

ES 로그 range 필터를 다음으로 변경:
- 기존: `gte: now-24h, lte: now`
- 변경: **`gte: now-(24+Δ)h, lte: now-Δ`** (길이 24h 유지, 양끝 Δ 미룸)

**양끝을 다 미루는 이유(갭 방지):** 끝(lte)만 `now-Δ`로 자르면 `(now-Δ, now]` 구간이 다음 리포트 창과 이어지지도 겹치지도 않아 Δ시간 갭이 생긴다. 양끝을 Δ만큼 미루면 매일 24h 창이 정확히 맞닿아(contiguous) 누락·중복이 0이 된다.
- 검증: 오늘창 끝 = `now-Δ`. 내일창 시작 = `(now+24h)-(24+Δ)h = now-Δ` = 오늘창 끝. ∴ 연속.
- Δ를 초과하는 지연은 여전히 누락될 수 있음(안전 오프셋의 한계, 사용자 합의됨).

## 3. 설정값

`grafana_report_settings`에 컬럼 추가:
- `log_lag_hours SMALLINT NOT NULL DEFAULT 3 CHECK (log_lag_hours BETWEEN 0 AND 24)`
- 기존 단일 행은 ALTER의 DEFAULT로 자동 3이 채워짐.
- 폴백 상수 `LOG_INDEX_LAG_HOURS = 3` (config.js) — 설정 조회 실패/누락 시 기본.

## 4. 적용 범위

- **웹 `/report`와 예약 `/tick` 모두** 동일하게 `settings.log_lag_hours`를 적용(일관성·단일 설정원). 웹 새로고침도 "now-Δ 기준"이 된다(방금 난 에러는 ~Δ 뒤 노출).
- **메트릭(Prometheus)은 변경 없음** — 스크랩이 실시간이라 적재 지연과 무관.
- 발송/스케줄/라벨/이메일 템플릿 불변.

## 5. 변경 파일 / 인터페이스

| 파일 | 변경 |
|------|------|
| `server/grafana/config.js` | `export const LOG_INDEX_LAG_HOURS = 3` 추가 |
| `server/grafana/report.js` | 순수함수 `esLogRange(hours, lagHours)` 추가 → `{ gte, lte }` (date-math 문자열). `lagHours=0`이면 `{gte:'now-24h', lte:'now'}`, `lagHours=3`이면 `{gte:'now-27h', lte:'now-3h'}` |
| `server/grafana/client.js` | `queryElasticsearch(queries, hours, fetchSize, lagHours = 0)` — range를 `esLogRange(hours, lagHours)`로 빌드. `gatherReportData(lagHours = LOG_INDEX_LAG_HOURS)` — `queryElasticsearch(..., lagHours)` 전달 |
| 마이그레이션 `supabase/migrations/20260608000000_add_log_lag_hours.sql` | 위 ALTER 문(멱등) |
| `server/grafana/settings.js` | `saveSettings({ recipients, send_hour, enabled, log_lag_hours })` — 컬럼 저장에 포함 |
| `server/routes/grafana.js` | GET `/settings`: 응답에 `log_lag_hours` 포함. PUT `/settings`: `log_lag_hours` 정수 0–24 검증(아니면 400), 저장. `/report`·`/tick`: `getSettings()` 후 `gatherReportData(settings.log_lag_hours)` 호출 |
| `src/lib/api/grafana.js` | 변경 없음(이미 body 전체 전송/수신) |
| `src/components/grafana/GrafanaSettings.jsx` | "로그 적재 지연 보정(시간)" 필드 추가 — `<select>` 0–24 또는 number, 기본 3. 로드/저장 payload에 `log_lag_hours` 포함 |
| `src/index.css` | 필요 시 최소 (기존 `.form-*` 재사용, 신규 거의 없음) |

### esLogRange 명세
```
esLogRange(hours, lagHours) → {
  gte: `now-${hours + lagHours}h`,
  lte: lagHours > 0 ? `now-${lagHours}h` : 'now',
}
```
(lagHours=0일 때 `lte:'now'`로 기존 동작과 동일하게 유지.)

## 6. /report 변경 주의

현재 `/report`는 `getSettings`를 호출하지 않는다. 이제 설정값을 적용하려면 `getSettings()`를 호출해 `log_lag_hours`를 읽는다. 설정 조회 실패 시 안전하게 `LOG_INDEX_LAG_HOURS`(3) 폴백.

## 7. 테스트

- `report.test.js`: `esLogRange` 단위테스트
  - `esLogRange(24, 0)` → `{gte:'now-24h', lte:'now'}`
  - `esLogRange(24, 3)` → `{gte:'now-27h', lte:'now-3h'}`
  - `esLogRange(24, 24)` → `{gte:'now-48h', lte:'now-24h'}`
- `routes/grafana.test.js`:
  - GET `/settings` 응답에 `log_lag_hours` 포함(env-fallback 무관).
  - PUT `/settings`: `log_lag_hours` 범위 밖(예: 25, -1, 비정수) → 400. 정상값 저장 시 `saveSettings`가 `log_lag_hours` 포함해 호출됨.
  - `/tick` 발송 경로: `gatherReportData`가 설정의 `log_lag_hours`로 호출되는지(모킹 인자 확인). (client/email/settings 모킹)
  - 기존 PUT 저장 테스트의 `saveSettings` 호출 단언에 `log_lag_hours` 추가.

## 8. 배포

1. 코드 배포: push + `vercel --prod`.
2. Supabase 대시보드 SQL Editor에서 ALTER 실행(멱등). **`supabase db push` 금지**(로컬/원격 마이그레이션 이력 divergence).
3. 검증: `/settings`에 `log_lag_hours:3` 응답, `/report` 정상, 설정 탭에서 값 변경 저장.

## 9. 함정 / 비고

- Δ 초과 지연은 여전히 누락(설계 한계). 필요 시 추후 watermark 방식으로 강화 가능.
- 웹 `/report`도 오프셋 적용되어 "지금"보다 Δ 과거가 보임 — 의도된 일관성.
- ALTER의 `DEFAULT 3`이 기존 단일 행을 3으로 백필.
