# Grafana 리포트 (CS SmartHub 툴) 설계

**작성일:** 2026-06-05
**상태:** 승인됨 (구현 대기)

## 목표

CS SmartHub 허브에 **Grafana 모니터링 리포트** 툴을 추가한다. 기존 독립 실행형 Python 스크립트(`~/grafana-monitoring/grafana_daily_report.py`)의 로직을 **Node/Express로 포팅**해, 허브 안에서:

1. **웹 on-demand 조회** — `/grafana` 페이지에서 버튼으로 지금 시점 리포트를 조회·표시
2. **일일 자동 이메일** — Vercel Cron이 매일 09:00 KST에 리포트를 생성해 이메일 발송

리포트 내용(Python과 동일):
- **리소스 점검**: Prometheus 메트릭 5종(CPU/메모리/디스크/비정상Pod/Pod재시작)의 임계치 초과 여부
- **앱별 에러 로그**: Elasticsearch에서 지난 24시간 error 로그를 앱별(chatbot/soe/c3/webhook/docstore)로 집계

## 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 스택 | Python → Node/Express 포팅. 기존 허브(React + Express, Vercel 서버리스)에 통합 |
| 데이터 신선도 | **Stateless 라이브 조회** (저장/이력 없음). 열 때마다 Grafana 직접 조회 |
| 화면 표시 | **네이티브 React UI** (허브 다크 테마). 백엔드는 JSON 반환, 프런트가 카드/테이블 렌더 |
| 일일 자동화 | **Vercel Cron** → `GET /api/grafana/cron` (09:00 KST = UTC `0 0 * * *`) |
| 이메일 발신 | **전용 Gmail** (env), nodemailer 재사용. 다중 수신(쉼표 구분) |
| 인증 | 웹 `/report`는 허브 비밀번호(`x-app-password`), `/cron`은 `CRON_SECRET` Bearer |

## 아키텍처

```
[GrafanaPage.jsx] --GET /api/grafana/report--> [Express grafana router]
                                                      │ (x-app-password 인증)
                                                      ▼
                                            [server/grafana/client.js]  ──→ Grafana API
                                            (Prometheus instant + ES _msearch proxy)
                                                      │
                                                      ▼
                                            [server/grafana/report.js]  (순수 함수)
                                            buildReport(raw) → JSON {summary, metrics[], logs[]}
                                                      │
                       ┌──────────────────────────────┴───────────────┐
              웹: JSON 그대로 반환                          Cron: buildEmailHtml(report) → email.js 발송
                       │                                              ▲
                       ▼                                  [GET /api/grafana/cron] ← Vercel Cron
              React 카드/테이블 렌더                          (CRON_SECRET 인증)
```

기존 `api/index.js`(Express 전체를 Vercel 함수로 래핑)와 `vercel.json` rewrite 위에 그대로 얹힌다. 새 인프라 없음.

## 백엔드 모듈

관심사 분리: **조회(client) / 가공(report, 순수) / 발송(email) / 라우팅(routes)**.

| 파일 | 역할 | 공개 인터페이스 | 의존 |
|---|---|---|---|
| `server/grafana/config.js` | 모니터링 정의 상수 (Python STEP 2 이식) | `METRICS[]`, `LOG_QUERIES[]`, `LOG_HOURS`, `LOG_FETCH`, `LOG_SHOW` | — |
| `server/grafana/client.js` | Grafana API 호출만 | `queryPrometheus(expr)` → number\|null, `queryElasticsearch(queries, hours, fetch)` → `{label:{count,rows}}`, `getEsIndexAndTimeField(uid)` | env, fetch |
| `server/grafana/report.js` | **순수 가공** (외부 의존 없음) | `buildReport({metrics, logs})` → 아래 JSON, `buildEmailHtml(report)` → string, `fmtTimeKst(iso)` → string | — |
| `server/grafana/email.js` | HTML 메일 발송 | `sendReportEmail(html)` | nodemailer, env |
| `server/routes/grafana.js` | 라우팅 (placeholder 교체) | `GET /report` (인증→조회→`buildReport`→JSON), `GET /cron` (CRON_SECRET→조회→메일→`{sent,alerts}`) | 위 모듈 |

### `buildReport` 반환 형태

```js
{
  generatedAt: "2026-06-05T00:00:00.000Z",
  summary: { alerts: 1, status: "alert" | "ok" },
  metrics: [
    { label: "CPU 사용률(최대, %)", value: 13.7, threshold: 80, over: false, error: null }
    // value=null & error="데이터 없음" 가능
  ],
  logs: [
    { app: "soe", count: 1, rows: [ { time: "2026-06-03 16:37", msg: "..." } ] }
    // error 시: { app, count: 0, error: "조회 실패" }
  ]
}
```

### Grafana 조회 세부 (Python 이식)

- **메트릭**: `POST /api/ds/query`, PromQL instant(`instant:true`). 5개 쿼리 병렬 호출. 응답에서 마지막 값 추출(`results.A.frames[0].data.values[-1][-1]`).
- **로그**: 데이터소스 프록시 `POST /api/datasources/proxy/uid/{ES_UID}/_msearch` (NDJSON, `Content-Type: application/x-ndjson`). 5개 query_string을 한 번에 묶고 `responses[]`로 앱별 분리. `track_total_hits:true`로 정확한 총건수.
- **인덱스/시간필드 자동 탐지**: `GET /api/datasources/uid/{ES_UID}`의 `jsonData.index`/`database`/`jsonData.timeField`(기본 `@timestamp`). `[prefix]YYYY.MM.DD` 템플릿 → `prefix*` 와일드카드 변환.
- 메시지 필드 추출 순서: `message → log → msg → JSON(src)`.
- 시간: UTC ISO → KST(+9) `YYYY-MM-DD HH:MM`.

## 프런트엔드

| 파일 | 내용 |
|---|---|
| `src/lib/api/grafana.js` | `getReport(pw)` → `GET /api/grafana/report`, `x-app-password` 헤더, 401→`throw 'UNAUTHORIZED'` (mailer 클라이언트 패턴 동일) |
| `src/pages/GrafanaPage.jsx` | placeholder 교체. `AppHeader` + 새로고침 버튼 + 요약 배지 + 리소스 카드 그리드 + 앱별 로그 테이블 |
| `src/index.css` | `.grafana-*` 다크 테마 스타일 추가 |
| `src/pages/HubPage.jsx` | TOOLS의 grafana 항목 `active: true`로 전환 |

UX:
- 진입 시 자동 1회 조회 → 로딩 → 렌더. "새로고침" 버튼으로 재조회.
- 요약 배지: `정상`(초록) / `이상 N건`(빨강).
- 리소스 카드: 항목별 값 + 임계 + 정상/경고 색상. `데이터 없음`은 회색.
- 로그: 앱별 건수 + 최근 `LOG_SHOW`(5)건 `시각·메시지` 테이블. 0건은 정상 표기.
- 조회 실패 시 에러 배너.

## Vercel Cron

`vercel.json`에 추가:
```json
"crons": [{ "path": "/api/grafana/cron", "schedule": "0 0 * * *" }]
```
- UTC 00:00 = KST 09:00.
- Vercel이 `Authorization: Bearer <CRON_SECRET>` 헤더로 호출 → `/cron`이 검증(불일치 401).
- 동작: 조회 → `buildReport` → `buildEmailHtml` → `sendReportEmail` → `{ sent: true, alerts: N }`.

## 환경변수

```
# Grafana 조회
GRAFANA_URL=https://grafana.next-ti.ai
GRAFANA_TOKEN=glsa_xxx
PROM_UID=...
ES_UID=...
# 전용 Gmail 발송
GRAFANA_EMAIL_FROM=...@gmail.com
GRAFANA_EMAIL_PASSWORD=...        # Gmail 앱 비밀번호
GRAFANA_EMAIL_TO=a@x.com,b@y.com  # 쉼표 구분
# Cron 인증
CRON_SECRET=...
```
mailer의 `SUPABASE_*`/`APP_PASSWORD`와 별개. 로컬 `.env` + Vercel(Production) 양쪽에 설정.

## 에러 처리

- **메트릭 개별 실패/데이터없음**: 해당 항목만 표기, 나머지 정상 렌더 (전체 중단 X).
- **ES 조회 실패**: 로그 섹션만 에러, 리소스 섹션 정상.
- **Grafana 전체 실패(인증/네트워크)**: `/report` 502 + 메시지 → 프런트 에러 배너.
- **Cron 메일 발송 실패**: 500 + 로깅. 조회 성공/메일 실패 구분.
- **env 누락**: 호출 시점에 명확한 메시지(예: "GRAFANA_TOKEN 미설정").

## 테스트 (TDD)

- `server/grafana/report.test.js` — 순수 함수 핵심: 샘플 Prometheus/ES 원본 fixture → `buildReport`의 `summary.alerts`, 임계 초과 판정, 로그 건수/행 파싱, `fmtTimeKst` UTC→KST 변환.
- `server/routes/grafana.test.js` — supertest + vitest: `/report` 무인증 401 / client 모킹 200+JSON, `/cron` CRON_SECRET 검증 / email 모킹.
- `client.js`는 외부 의존이라 단위테스트 제외 — 로직은 `report.js`에 집중.

## 범위 밖 (YAGNI)

- 리포트 이력 저장/조회 (필요 시 Supabase 테이블로 확장 — 본 설계의 B안).
- 임계치/쿼리의 UI 편집 (코드 상수로 관리, `config.js` 수정).
- Slack 발송 (Python HANDOVER엔 언급되나 현재 요구 아님).

## 후속 (구현 시 주의)

- 실제 클러스터 메트릭 라벨이 다르면 "데이터 없음" 발생 → 기존 대시보드 패널 쿼리로 교체 (`config.js`). 단, Python 샘플 리포트(`grafana_report_20260604.txt`)는 실환경에서 정상 동작 확인됨.
- Vercel 함수 타임아웃: 메트릭 5 + ES 1 호출. 메트릭 병렬화로 수 초 내. 필요 시 `maxDuration` 조정.
