# 설계 — Grafana 리포트 이메일 템플릿 개선

> 작성일 2026-06-08. 프로젝트 `/Users/sangjun/IdeaProjects/mailer`.
> 참고 원본: `~/grafana-monitoring/grafana_daily_report.py`의 `build_html_report()`.

## 1. 목적

자동 발송되는 Grafana 모니터링 이메일의 HTML 템플릿을, 기존 Python 스크립트의 더 보기 좋은 디자인에 **충실히 맞춰** 개선한다. 이메일 클라이언트(Gmail 등) 호환을 위해 CSS는 전부 **인라인**으로 작성한다.

## 2. 범위

- **변경**: `server/grafana/report.js`의 `buildEmailHtml(report)` 함수 1개.
- **테스트**: `server/grafana/report.test.js`의 `buildEmailHtml` describe 블록 확장.
- **비변경**: 웹 UI(`GrafanaPage.jsx`), 데이터 수집(`client.js`), 리포트 빌드(`buildReport`), 발송(`email.js`), 라우트. 데이터 구조 그대로 사용.

## 3. 입력 데이터 (기존 `report` 객체, 불변)

```
report = {
  generatedAt: ISO UTC 문자열,
  summary: { alerts: number, status: 'alert'|'ok' },
  metrics: [{ label, value(number|null), threshold, over(bool), error(string|null) }],
  logs:    [{ app, count(number), rows: [{ time, msg }], error(string|null) }],
}
```
`rows[].time`은 이미 KST로 포맷됨(`fmtTimeKst`, 수집 단계). `generatedAt`만 본 함수에서 KST 변환.

## 4. 출력 HTML 구조 (Python `build_html_report` 재현, 인라인 CSS)

순서:
1. `<html><head><meta charset="utf-8"></head><body>` — body: 시스템 폰트, `margin:0;padding:20px;background:#f5f5f5`.
2. **컨테이너** `<div>`: `max-width:800px;margin:0 auto;background:#fff;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)`.
3. **제목** `<h1>`: `📊 그라파나 모니터링 보고서` — `color:#333;font-size:24px;margin:0 0 10px`.
4. **날짜**: `color:#666;font-size:14px;margin-bottom:20px`. 형식 **`YYYY년 MM월 DD일 HH:MM (KST)`** (generatedAt → KST). 새 헬퍼 `fmtKoreanKst(ts)`로 생성(아래 5절).
5. **요약 박스**: `padding:15px;border-radius:6px;margin-bottom:20px;font-size:16px;font-weight:bold`.
   - alert: `background:#ffebee;color:#c62828;border-left:4px solid #c62828`.
   - ok: `background:#e8f5e9;color:#2e7d32;border-left:4px solid #2e7d32`.
   - 텍스트: `⚠️ 이상 N건 — 점검 필요` / `✅ 정상`.
6. **파란 부제**: `📊 지난 24시간 모니터링 현황` — `font-size:18px;font-weight:bold;color:#333;margin-bottom:20px;padding-bottom:10px;border-bottom:2px solid #2196F3`.
7. **리소스 섹션**:
   - 섹션 타이틀 박스: `background:#f5f5f5;padding:12px 15px;border-radius:4px;font-weight:bold;color:#333;margin-bottom:15px` → `📈 리소스 사용량`.
   - 테이블 `width:100%;border-collapse:collapse`. 헤더행 th: `background:#fafafa;padding:10px 12px;text-align:left;font-weight:600;color:#555;border-bottom:1px solid #ddd` — 컬럼 `항목` / `값`(우정렬) / `임계`(우정렬).
   - 각 메트릭 행 td: `padding:10px 12px;border-bottom:1px solid #eee`.
     - 상태 아이콘 `<span>`: over면 `color:#c62828` ⚠, error/null이면 `color:#2e7d32` ○, 정상이면 `color:#2e7d32` ✓.
     - 값: error면 에러문구, `value==null`이면 `데이터 없음`, number면 `toFixed(1)`, 그 외 원값. 우정렬·`font-weight:600`.
     - 임계: 우정렬·`font-weight:600`.
8. **로그 섹션**:
   - 섹션 타이틀 박스 `🔍 ERROR 로그 (앱별)`.
   - 앱별 헤더 `<div style="margin-bottom:15px">`: `<strong>{아이콘} {app}</strong>: <span style="color:#666">{표시}</span>`.
     - 아이콘: `error`거나 `count>0`이면 ⚠(`#c62828`), 아니면 ✓(`#2e7d32`).
     - 표시: error면 에러문구, 아니면 `{count}건`.
   - `error` 없고 `count>0`이면 테이블: th `시간`/`메시지`(위 th 스타일). 행은 `rows.slice(0,5)`:
     - 시간 td: `color:#999;font-size:12px` + 기본 td 패딩/보더.
     - 메시지 td: `color:#555;word-break:break-word`, `msg.slice(0,150)`.
   - `count>5`이면 마지막에 `<tr><td colspan="2" style="color:#999;text-align:center;padding:10px 12px">... 외 {count-5}건</td></tr>`.
9. `</div></body></html>`.

모든 텍스트는 기존 `esc()`로 이스케이프(XSS 방지) 유지.

## 5. 헬퍼

- 기존 `fmtTimeKst(ts)` (그대로) — 로그 행 시각용. 본 함수에서는 직접 호출 안 함(rows.time이 이미 포맷됨).
- **신규(파일 내부, 비export 또는 export)** `fmtKoreanKst(ts)`: UTC ISO → `YYYY년 MM월 DD일 HH:MM` (KST). `fmtTimeKst`와 동일한 +9시간 UTC 산술 사용, 출력 형식만 한국어. 빈 값이면 빈 문자열.

## 6. 상수

- 로그 표시 행 수: `LOG_SHOW = 5` (현재 동작과 동일, 매직넘버 제거 위해 함수 상단 상수화).
- 메시지 미리보기 길이: 150 (Python과 동일; 현재 Node는 150이었음 — 유지).

## 7. 테스트 (`report.test.js` buildEmailHtml 확장)

기존 1개 테스트 유지·강화 + 케이스 추가:
1. 기본 렌더: `<html` 포함, 요약 문구(`이상 1건`), 앱 라벨(`soe`), 로그 메시지(`boom`) 포함 — 기존 유지.
2. 새 디자인 요소 포함: `지난 24시간`, `box-shadow`, 섹션 타이틀(`📈 리소스 사용량`), 테이블 헤더(`항목`, `시간`) 문자열 포함.
3. 날짜 KST 한국어 형식: `2026년` 및 `(KST)` 포함(generatedAt `2026-06-05T00:00:00Z` → `2026년 06월 05일 09:00`).
4. 초과 행: `count`가 5 초과인 로그(예: count=8, rows 8개)일 때 `외 3건` 포함; `count<=5`이면 미포함.
5. 이스케이프 유지: 메시지에 `<script>` 넣으면 `&lt;script&gt;`로 이스케이프.

## 8. 검증

- `npm test` 전체 통과(report.test.js 포함).
- (선택) 샘플 리포트로 HTML 파일 생성 후 브라우저 미리보기로 육안 확인.

## 9. 영향 / 함정

- 발송 경로(`/tick`)·수신자·스케줄 변경 없음. 순수하게 HTML 문자열 생성만 개선.
- 인라인 스타일 고수: `<style>` 블록은 일부 메일 클라이언트가 무시하므로 사용하지 않음.
- 즉시 발송 버튼이 없으므로(설계상), 실제 메일 육안 확인은 다음 예약 발송 또는 샘플 HTML 미리보기로 대체.
