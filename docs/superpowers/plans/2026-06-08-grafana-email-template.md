# Grafana 이메일 템플릿 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동 발송 Grafana 이메일의 `buildEmailHtml`을 Python 원본 디자인(그림자·섹션 타이틀 박스·테이블 헤더·파란 부제·로그 컬럼 헤더·"외 N건" 초과행)에 충실히 맞춰 개선한다. CSS는 전부 인라인.

**Architecture:** `server/grafana/report.js`의 `buildEmailHtml(report)` 한 함수만 교체하고, 날짜용 내부 헬퍼 `fmtKoreanKst(ts)`를 추가한다. 데이터 구조·발송 경로·웹 UI는 불변. TDD로 `report.test.js`의 `buildEmailHtml` 테스트를 먼저 확장한 뒤 구현.

**Tech Stack:** Node ESM, Vitest. 순수 문자열 생성 함수(외부 의존성 없음).

---

## 파일 구조

| 파일 | 책임 | 작업 |
|------|------|------|
| `server/grafana/report.js` | `buildEmailHtml` 교체 + `fmtKoreanKst` 헬퍼 추가 | Modify |
| `server/grafana/report.test.js` | `buildEmailHtml` describe 블록 확장 | Modify |

> `buildEmailHtml`은 현재 파일 끝(약 80–111행)에 위치. `fmtTimeKst`/`extractPromValue`/`buildReport` 등 다른 export는 건드리지 않는다.

---

## Task 1: 이메일 템플릿 재디자인 (TDD)

**Files:**
- Modify: `server/grafana/report.js`
- Test: `server/grafana/report.test.js`

- [ ] **Step 1: 테스트 확장 (실패 먼저)**

`server/grafana/report.test.js`에서 기존 `describe('buildEmailHtml', ...)` 블록 전체를 아래로 **교체**한다. (파일 상단 import에 `buildReport`, `buildEmailHtml`가 이미 있음 — 변경 불필요.)

```javascript
describe('buildEmailHtml', () => {
  const baseReport = (over = {}) => buildReport({
    generatedAt: '2026-06-05T00:00:00.000Z',
    metrics: [{ label: 'CPU', value: 13.7, threshold: 80, error: null }],
    logs: [{ app: 'soe', count: 1, rows: [{ time: '2026-06-03 16:37', msg: 'boom' }], error: null }],
    ...over,
  })

  it('요약과 앱 라벨/메시지가 포함된 HTML 반환', () => {
    const html = buildEmailHtml(baseReport())
    expect(html).toContain('<html')
    expect(html).toContain('이상 1건')
    expect(html).toContain('soe')
    expect(html).toContain('boom')
  })

  it('새 디자인 요소 포함(그림자/부제/섹션타이틀/테이블헤더)', () => {
    const html = buildEmailHtml(baseReport())
    expect(html).toContain('box-shadow')
    expect(html).toContain('지난 24시간 모니터링 현황')
    expect(html).toContain('📈 리소스 사용량')
    expect(html).toContain('🔍 ERROR 로그')
    expect(html).toContain('>항목<')
    expect(html).toContain('>시간<')
    expect(html).toContain('>메시지<')
  })

  it('날짜를 KST 한국어 형식으로 표시', () => {
    const html = buildEmailHtml(baseReport())
    // 2026-06-05T00:00Z → KST 09:00
    expect(html).toContain('2026년 06월 05일 09:00')
    expect(html).toContain('(KST)')
  })

  it('로그가 5건 초과면 "외 N건" 행 표시', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ time: `t${i}`, msg: `m${i}` }))
    const html = buildEmailHtml(baseReport({ logs: [{ app: 'soe', count: 8, rows, error: null }] }))
    expect(html).toContain('외 3건')
  })

  it('로그가 5건 이하면 "외" 초과행 없음', () => {
    const html = buildEmailHtml(baseReport())
    expect(html).not.toContain('외 ')
  })

  it('로그 그룹 에러는 메시지 표기하고 행 테이블 없음', () => {
    const html = buildEmailHtml(baseReport({ logs: [{ app: 'soe', count: 0, rows: [], error: 'ES 조회 실패' }] }))
    expect(html).toContain('ES 조회 실패')
  })

  it('메시지를 HTML 이스케이프', () => {
    const html = buildEmailHtml(baseReport({ logs: [{ app: 'soe', count: 1, rows: [{ time: 't', msg: '<script>x</script>' }], error: null }] }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run server/grafana/report.test.js`
Expected: 새 단언(`box-shadow`, `지난 24시간 모니터링 현황`, `>항목<`, `외 3건`, 한국어 날짜 등)에서 FAIL. 기존 `buildEmailHtml` 구버전은 이 문자열들을 포함하지 않음.

- [ ] **Step 3: 구현 — `buildEmailHtml` 교체 + `fmtKoreanKst` 추가**

`server/grafana/report.js`에서 기존 `buildEmailHtml` 함수(파일 끝 `// 이메일용 HTML ...` 주석부터 끝까지)를 아래로 **교체**한다. `fmtKoreanKst` 헬퍼를 그 위에 추가한다. 다른 함수는 그대로 둔다.

```javascript
// UTC ISO → KST(+9) "YYYY년 MM월 DD일 HH:MM"
function fmtKoreanKst(ts) {
  if (!ts) return ''
  const base = String(ts).replace('Z', '').split('.')[0]
  const d = new Date(base + 'Z')
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}년 ${p(kst.getUTCMonth() + 1)}월 ${p(kst.getUTCDate())}일 ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
}

// 이메일용 HTML (라이트 테마, 메일 클라이언트 호환 — 전부 인라인 스타일)
export function buildEmailHtml(report) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const LOG_SHOW = 5
  const MSG_PREVIEW = 150
  const alerts = report.summary.alerts
  const summaryText = alerts ? `⚠️ 이상 ${alerts}건 — 점검 필요` : '✅ 정상'
  const summaryStyle = alerts
    ? 'background:#ffebee;color:#c62828;border-left:4px solid #c62828'
    : 'background:#e8f5e9;color:#2e7d32;border-left:4px solid #2e7d32'

  const th = 'background:#fafafa;padding:10px 12px;text-align:left;font-weight:600;color:#555;border-bottom:1px solid #ddd'
  const thR = th + ';text-align:right'
  const td = 'padding:10px 12px;border-bottom:1px solid #eee'
  const tdR = 'padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600'
  const sectionTitle = 'background:#f5f5f5;padding:12px 15px;border-radius:4px;font-weight:bold;color:#333;margin-bottom:15px'

  const metricRows = report.metrics.map((m) => {
    let icon, val
    if (m.error) {
      icon = '<span style="color:#2e7d32">○</span>'; val = esc(m.error)
    } else if (m.value == null) {
      icon = '<span style="color:#2e7d32">○</span>'; val = '데이터 없음'
    } else {
      icon = m.over ? '<span style="color:#c62828">⚠</span>' : '<span style="color:#2e7d32">✓</span>'
      val = typeof m.value === 'number' ? m.value.toFixed(1) : esc(m.value)
    }
    return `<tr><td style="${td}">${icon} ${esc(m.label)}</td><td style="${tdR}">${val}</td><td style="${tdR}">${m.threshold}</td></tr>`
  }).join('')

  const logBlocks = report.logs.map((g) => {
    const isAlert = g.error || g.count > 0
    const icon = isAlert ? '<span style="color:#c62828">⚠</span>' : '<span style="color:#2e7d32">✓</span>'
    const head = `<div style="margin-bottom:15px"><strong>${icon} ${esc(g.app)}</strong>: <span style="color:#666">${g.error ? esc(g.error) : g.count + '건'}</span>`
    if (g.error || !g.count) return head + '</div>'
    const rows = g.rows.slice(0, LOG_SHOW).map((r) =>
      `<tr><td style="${td};color:#999;font-size:12px">${esc(r.time)}</td><td style="${td};color:#555;word-break:break-word">${esc(r.msg.slice(0, MSG_PREVIEW))}</td></tr>`
    ).join('')
    const overflow = g.count > LOG_SHOW
      ? `<tr><td colspan="2" style="padding:10px 12px;color:#999;text-align:center">... 외 ${g.count - LOG_SHOW}건</td></tr>`
      : ''
    return head + `<table style="width:100%;border-collapse:collapse;margin:8px 0 10px"><tr><th style="${th}">시간</th><th style="${th}">메시지</th></tr>${rows}${overflow}</table></div>`
  }).join('')

  return `<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f5f5f5">
<div style="max-width:800px;margin:0 auto;background:#fff;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)">
<h1 style="color:#333;margin:0 0 10px;font-size:24px">📊 그라파나 모니터링 보고서</h1>
<div style="color:#666;font-size:14px;margin-bottom:20px">${esc(fmtKoreanKst(report.generatedAt))} (KST)</div>
<div style="padding:15px;border-radius:6px;margin-bottom:20px;font-size:16px;font-weight:bold;${summaryStyle}">${summaryText}</div>
<div style="font-size:18px;font-weight:bold;color:#333;margin-bottom:20px;padding-bottom:10px;border-bottom:2px solid #2196F3">📊 지난 24시간 모니터링 현황</div>
<div style="${sectionTitle}">📈 리소스 사용량</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:25px"><tr><th style="${th}">항목</th><th style="${thR}">값</th><th style="${thR}">임계</th></tr>${metricRows}</table>
<div style="${sectionTitle}">🔍 ERROR 로그 (앱별)</div>${logBlocks}
</div></body></html>`
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run server/grafana/report.test.js`
Expected: PASS (buildEmailHtml 7개 포함 전체 통과).

- [ ] **Step 5: 전체 테스트 + lint**

Run: `npm test`
Expected: 전체 PASS (기존 49 + buildEmailHtml 추가분; report.test.js의 다른 테스트 영향 없음).
Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: (선택) 샘플 HTML 육안 미리보기**

발송 버튼이 없으므로 샘플 HTML을 파일로 떨궈 브라우저로 확인할 수 있다(커밋엔 포함하지 않음, 확인 후 삭제):
```bash
node --input-type=module -e '
import { buildReport, buildEmailHtml } from "./server/grafana/report.js"
import { writeFileSync } from "fs"
const r = buildReport({
  generatedAt: "2026-06-08T00:00:00Z",
  metrics: [
    { label: "CPU 사용률(최대, %)", value: 27.6, threshold: 80, error: null },
    { label: "메모리 사용률(최대, %)", value: 88.1, threshold: 85, error: null },
    { label: "비정상 상태 Pod 수", value: null, threshold: 0, error: null },
  ],
  logs: [
    { app: "chatbot", count: 7, rows: Array.from({length:7},(_,i)=>({time:`2026-06-08 0${i}:10`, msg:`error sample ${i}`})), error: null },
    { app: "soe", count: 0, rows: [], error: null },
  ],
})
writeFileSync("/tmp/grafana-email-preview.html", buildEmailHtml(r))
console.log("wrote /tmp/grafana-email-preview.html")'
open /tmp/grafana-email-preview.html
```
확인 후 `/tmp/grafana-email-preview.html` 삭제.

- [ ] **Step 7: Commit**

```bash
git add server/grafana/report.js server/grafana/report.test.js
git commit -m "feat(grafana): redesign report email template to match python version"
```
End the commit message with this trailer (blank line before it):
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

## Self-Review

- **Spec coverage**: 컨테이너+그림자(§4.2), 제목/날짜 한국어 KST(§4.3·4.4, `fmtKoreanKst`), 요약박스(§4.5), 파란 부제(§4.6), 리소스 섹션+th/아이콘(§4.7), 로그 섹션+컬럼헤더+초과행+에러(§4.8), esc 유지(§4·§5), LOG_SHOW=5/미리보기150(§6), 테스트 5종(§7) → 모두 Task 1 단계에 포함. ✅
- **Placeholder scan**: 코드·테스트 전부 실제 내용. TBD 없음. ✅
- **Type/이름 일관성**: `fmtKoreanKst`(헬퍼), `buildEmailHtml`(export) 시그니처 불변(report 1개 인자). `report.logs[].rows[].{time,msg}`, `metrics[].{label,value,threshold,over,error}` 사용 — `buildReport` 출력과 일치. ✅
