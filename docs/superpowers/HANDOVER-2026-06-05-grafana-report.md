# 인수인계서 — Grafana 리포트 툴 (CS SmartHub)

> **다음 세션용.** 이 문서만 보고 이어서 작업하면 됩니다. 작성일 2026-06-05.
> 프로젝트: `/Users/sangjun/IdeaProjects/mailer` (브랜치 `main`, 직접 커밋 방식)

---

## 0. 30초 요약

CS SmartHub 허브에 **Grafana 모니터링 리포트** 툴 추가. 기존 Python 스크립트(`~/grafana-monitoring/grafana_daily_report.py`)를 **Node/Express로 포팅**:
- 허브 `/grafana` 페이지에서 **웹 on-demand 조회**(네이티브 React UI)
- 매일 설정된 시각(KST)에 리포트 **이메일 자동 발송**

> 🔄 **2026-06-05 (2차) 업데이트 — 발송 설정 기능 추가, 스케줄 방식 변경.**
> - 수신자·발송 시각(시 단위, KST)·자동발송 토글을 `/grafana` **"설정" 탭**에서 편집(Supabase `grafana_report_settings` 싱글톤).
> - **스케줄러 변경**: ~~Vercel Cron `/api/grafana/cron`~~ → **Supabase pg_cron**이 매시간 `GET /api/grafana/tick`(Bearer `CRON_SECRET`) 호출 → 내부에서 "현재 KST 시 == 설정 시각 & 오늘 미발송"일 때만 발송. `vercel.json`의 crons는 제거됨.
> - `GRAFANA_EMAIL_TO` env는 설정 recipients가 비었을 때의 **폴백**으로만 사용. 완전 중단은 설정 탭의 "매일 자동 발송" 토글 OFF.
> - 설계/계획: `specs/2026-06-05-grafana-report-settings-design.md`, `plans/2026-06-05-grafana-report-settings.md`.
> - 배포됨: 코드(`vercel --prod`) + Supabase SQL 2개(테이블 생성, pg_cron `grafana-report-tick` `0 * * * *`) 적용 완료. `/settings`·`/tick` 프로덕션 검증 완료.

> ✅ **2026-06-05 배포 완료.** push·env 주입(8개)·`vercel --prod`·프로덕션 검증 모두 끝남.
> - push: `c2473f5..2f908de` (main)
> - prod API: 무인증 401 / 인증 200 + 실데이터(CPU 27.6 / MEM 57.4 / DISK 51.7 / alerts 2)
> - `/cron` 무인증 401(메일 미발송), Cron 등록 확인 `/api/grafana/cron @ 0 0 * * *`
> - 남은 선택사항: 실제 cron 이메일 1회 수동 트리거 테스트(E), 브라우저 UI 육안 확인(F)

---

## 1. 현재 상태

### ✅ 완료 (로컬, 전부 커밋됨)
- [x] 설계 스펙: `docs/superpowers/specs/2026-06-05-grafana-report-design.md`
- [x] 구현 계획: `docs/superpowers/plans/2026-06-05-grafana-report.md` (9 tasks)
- [x] Task 1~8 코드 전부 작성·커밋 (아래 "구현된 파일" 참고)
- [x] 전체 테스트 **28개 통과** (`npm test`) — grafana report 12 + routes 5 포함
- [x] `npm run lint` 클린, `npm run build` 성공
- [x] **라이브 Grafana 조회 검증 완료** — 실환경에서 메트릭 5종 실데이터, 로그 감지 정상
- [x] `/api/grafana/report` HTTP 검증 — 무인증 401 / 인증 200 + JSON
- [x] 로컬 `.env`에 Grafana 변수 8개 설정 완료 (gitignored)

### ⏳ 남은 일 (다음 세션이 할 것)
- [ ] **A. git push** — `main`에 미푸시 커밋 10개 있음 (`git log @{u}..HEAD`)
- [ ] **B. Vercel Production env 8개 주입** (아래 3절)
- [ ] **C. `vercel --prod` 재배포** → Vercel Cron 자동 등록(vercel.json의 crons)
- [ ] **D. 프로덕션 검증** — `https://mailer-two-chi.vercel.app`에서 허브 → Grafana 카드 → 리포트 렌더 확인
- [ ] **E. (선택) Cron 동작 확인** — `/api/grafana/cron`은 `Authorization: Bearer <CRON_SECRET>`로만 호출됨. 수동 트리거로 이메일 발송 1회 테스트 가능
- [ ] **F. 로컬 브라우저 확인** (안 했으면): `http://localhost:5173` → 로그인 → Grafana 카드

> ⚠️ **푸시/배포는 사용자 명시 승인 필요** (자동 모드가 main 직접 푸시·prod 배포를 차단함). "푸시해줘"/"배포해줘"를 받고 진행할 것.

---

## 2. 구현된 파일 (전부 커밋 완료)

### 백엔드 (`server/grafana/`, `server/routes/`)
| 파일 | 역할 |
|------|------|
| `server/grafana/config.js` | METRICS 5종(PromQL+임계) + LOG_QUERIES 5앱(chatbot/soe/c3/webhook/docstore) + 상수 |
| `server/grafana/report.js` | **순수 함수**: extractPromValue, normalizeEsIndex, fmtTimeKst(UTC→KST), parseEsResponses, **buildReport**, **buildEmailHtml** |
| `server/grafana/report.test.js` | 위 순수함수 단위테스트 12개 |
| `server/grafana/client.js` | Grafana API 호출(fetch): queryPrometheus, queryElasticsearch(_msearch), getEsIndexAndTimeField, **gatherReportData**(오케스트레이션, 개별 실패 격리) |
| `server/grafana/email.js` | nodemailer로 HTML 메일 발송(전용 Gmail env, 465 secure) |
| `server/routes/grafana.js` | `GET /report`(x-app-password 인증→JSON), `GET /cron`(CRON_SECRET→조회+메일) |
| `server/routes/grafana.test.js` | 라우터 테스트 5개 (client/email 모킹) |

### 프런트 (`src/`)
| 파일 | 역할 |
|------|------|
| `src/lib/api/grafana.js` | `getReport(pw)` — `/api/grafana/report` 호출, 401→`UNAUTHORIZED` |
| `src/pages/GrafanaPage.jsx` | placeholder 교체 → 요약 배지 + 리소스 카드 + 앱별 로그 테이블, "새로고침" 버튼 |
| `src/index.css` | `.grafana-*` 다크 테마 스타일 (파일 끝) |
| `src/pages/HubPage.jsx` | grafana 카드 `active: true` (허브에서 클릭 가능) |

### 설정
| 파일 | 변경 |
|------|------|
| `vercel.json` | `crons: [{ path: "/api/grafana/cron", schedule: "0 0 * * *" }]` 추가 (UTC 00:00 = KST 09:00) |
| `.env.example` | Grafana env 8개 문서화 |

> 라우팅: `server/index.js`가 이미 `app.use('/api/grafana', grafanaRouter)` 마운트함(기존). Express 전체는 `api/index.js`로 Vercel 서버리스 함수로 배포됨(mailer 때 구축).

---

## 3. 환경변수 (★배포 시 필수)

로컬 `.env`엔 **이미 설정 완료**. **Vercel Production엔 아직 없음 → B 단계에서 주입 필요.**

| 변수 | 값 출처 |
|------|---------|
| `GRAFANA_URL` | `https://grafana.next-ti.ai` |
| `GRAFANA_TOKEN` | Grafana 서비스계정 토큰 (`glsa_...`) |
| `PROM_UID` | Prometheus 데이터소스 uid |
| `ES_UID` | Elasticsearch 데이터소스 uid |
| `GRAFANA_EMAIL_FROM` | 발신 Gmail 주소 |
| `GRAFANA_EMAIL_PASSWORD` | Gmail 앱 비밀번호 |
| `GRAFANA_EMAIL_TO` | 수신자(쉼표 구분 다중) |
| `CRON_SECRET` | Vercel Cron 인증용 (로컬엔 openssl로 생성해 넣어둠) |

**값의 원본:** `~/grafana-monitoring/.env` (Python 프로젝트). 키 매핑: `EMAIL_FROM→GRAFANA_EMAIL_FROM`, `EMAIL_PASSWORD→GRAFANA_EMAIL_PASSWORD`, `EMAIL_TO→GRAFANA_EMAIL_TO`. 나머지 동일.

### Vercel 주입 방법 (mailer 때와 동일 패턴)
```bash
cd ~/IdeaProjects/mailer
for KEY in GRAFANA_URL GRAFANA_TOKEN PROM_UID ES_UID GRAFANA_EMAIL_FROM GRAFANA_EMAIL_PASSWORD GRAFANA_EMAIL_TO CRON_SECRET; do
  VAL=$(grep -E "^${KEY}=" .env | cut -d= -f2-)
  printf '%s' "$VAL" | npx vercel env add "$KEY" production
done
```
주의: `CRON_SECRET`은 로컬 `.env`의 값을 **그대로** Vercel에 넣어야 cron이 매칭됨. (Vercel Cron이 이 시크릿으로 `Authorization: Bearer` 헤더를 붙여 호출)

---

## 4. 검증 방법 (이어서 확인할 때)

```bash
cd ~/IdeaProjects/mailer

# 1) 전체 테스트
npm test                 # 28 passed 기대

# 2) 라이브 Grafana 조회 (실서버 직접 — 읽기전용)
node --input-type=module -e '
import "dotenv/config"
import { gatherReportData } from "./server/grafana/client.js"
import { buildReport } from "./server/grafana/report.js"
console.log(JSON.stringify((buildReport(await gatherReportData())).summary)); process.exit(0)'
# → {"alerts":N,"status":...} 나오면 정상

# 3) 로컬 dev + HTTP 엔드포인트
npm run dev              # vite :5173 + express :3001
APP_PW=$(grep -E '^APP_PASSWORD=' .env | cut -d= -f2-)
curl -s -H "x-app-password: $APP_PW" http://localhost:3001/api/grafana/report | head -c 300
# → {"generatedAt":...,"summary":...,"metrics":[5],"logs":[5]}
```

마지막 검증 결과(2026-06-05): 메트릭 CPU 27.6 / MEM 57.4 / DISK 51.7 / Pod 0 / restart 0 (전부 정상), 로그 chatbot 1·soe 2건 → alerts 2. **PromQL 쿼리가 실환경과 맞아 "데이터 없음" 없음.**

---

## 5. 꼭 알아야 할 컨텍스트 / 함정

1. **dev 서버 env 갱신**: `.env`를 수정하면 **dev 서버를 재기동**해야 반영됨(Node는 시작 시 1회 로드). 안 그러면 `/api/grafana/report`가 "GRAFANA_URL 미설정" 500.
2. **프로덕션 토폴로지** (mailer 기준, Grafana도 동일하게 얹힘):
   - 앱은 Vercel 배포(`mailer-two-chi.vercel.app`). Express 전체가 `api/index.js`로 서버리스 함수화, `vercel.json` rewrite `/api/* → 함수`.
   - **mailer 발송**은 별개로 Supabase Edge Function + pg_cron이 담당(건드리지 말 것). Grafana는 그것과 무관하게 Vercel Cron 사용.
   - Supabase 인스턴스(`enawzdqroidrhtjqhpka`)는 옆 프로젝트 `parking`과 공유 → Edge Function 로그에 `todos` 등 섞여 보이는 건 정상(무관).
3. **메트릭이 "데이터 없음" 뜨면**: 실클러스터 라벨이 다른 것. `server/grafana/config.js`의 METRICS PromQL을 기존 대시보드 패널 쿼리로 교체. (현재는 맞음)
4. **ES 로그 본문이 JSON 덩어리로 나오면**: 메시지 필드명 문제. `report.js`의 `parseEsResponses` 추출 순서(`message→log→msg`)에 실제 필드명 추가.
5. **`/cron`은 외부 무단 호출 차단됨**: `CRON_SECRET` Bearer 없으면 401. 수동 테스트 시 헤더 필요:
   `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/grafana/cron` → `{sent:true, alerts:N}` + 실제 메일 발송됨(주의).
6. **이 프로젝트는 main 직접 커밋** 방식(사용자 동의함). 단, **push/배포는 매번 사용자 명시 승인 필요**(자동모드 차단).

---

## 6. 참고 문서
- 설계: `docs/superpowers/specs/2026-06-05-grafana-report-design.md`
- 계획(전체 코드 포함): `docs/superpowers/plans/2026-06-05-grafana-report.md`
- 원본 Python: `~/grafana-monitoring/` (`grafana_daily_report.py`, `HANDOVER.md`, `README.md`)
- 프로젝트 메모리: `~/.claude/projects/-Users-sangjun-IdeaProjects-mailer/memory/` (prod topology, 첨부 실패 패턴)

## 7. 권장 다음 액션 순서
1. `npm test` + 라이브 조회로 현 상태 재확인 (4절)
2. 사용자에게 "push 할까요?" → `git push origin main`
3. Vercel env 8개 주입 (3절 스크립트)
4. 사용자에게 "배포할까요?" → `npx vercel --prod`
5. `https://mailer-two-chi.vercel.app` 브라우저에서 Grafana 카드 동작 확인
6. (선택) `/cron` 수동 1회 → 이메일 수신 확인
7. 완료 후 executing-plans 마무리(finishing-a-development-branch)
