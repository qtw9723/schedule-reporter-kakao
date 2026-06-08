// server/grafana/report.js

// Prometheus /api/ds/query 응답에서 마지막 값 추출
export function extractPromValue(resp) {
  try {
    const frames = resp?.results?.A?.frames
    if (!frames || !frames.length) return null
    const values = frames[0]?.data?.values
    if (!values || !values.length) return null
    const lastCol = values[values.length - 1]
    return lastCol && lastCol.length ? lastCol[lastCol.length - 1] : null
  } catch {
    return null
  }
}

// Grafana ES 인덱스 템플릿 [prefix]YYYY.MM.DD → prefix*
export function normalizeEsIndex(index) {
  return String(index).replace(/\[([^\]]+)\].*/, '$1*')
}

// UTC ISO → KST(+9) "YYYY-MM-DD HH:MM"
export function fmtTimeKst(ts) {
  if (!ts) return ''
  try {
    const base = String(ts).replace('Z', '').split('.')[0]
    const d = new Date(base + 'Z')
    if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
    const kst = new Date(d.getTime() + 9 * 3600 * 1000)
    const p = (n) => String(n).padStart(2, '0')
    return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
  } catch {
    return String(ts).slice(0, 16)
  }
}

// ES 로그 조회 시간창. 적재 지연(lagHours) 보정을 위해 now-lagHours에서 끝나는 hours 길이 창.
export function esLogRange(hours, lagHours = 0) {
  return {
    gte: `now-${hours + lagHours}h`,
    lte: lagHours > 0 ? `now-${lagHours}h` : 'now',
  }
}

// _msearch responses[] → {label: {count, rows}}
export function parseEsResponses(responses, queries, timefield) {
  const out = {}
  for (let i = 0; i < queries.length; i++) {
    const resp = responses[i] || {}
    const hits = resp.hits || {}
    const total = hits.total
    const count = (total && typeof total === 'object') ? (total.value || 0) : (total || 0)
    const rows = (hits.hits || []).map((h) => {
      const src = h._source || {}
      const ts = src[timefield] || ''
      const msg = src.message || src.log || src.msg || JSON.stringify(src)
      return { time: fmtTimeKst(String(ts)), msg: String(msg) }
    })
    out[queries[i].label] = { count, rows }
  }
  return out
}

// 수집된 원시 결과 → 최종 리포트 JSON (요약/over/alerts 계산)
export function buildReport({ metrics, logs, generatedAt }) {
  let alerts = 0
  const m = metrics.map((x) => {
    let over = false
    if (x.error == null && x.value != null) {
      const v = Number(x.value)
      over = !Number.isNaN(v) && v > x.threshold
    }
    if (over) alerts++
    return { label: x.label, value: x.value ?? null, threshold: x.threshold, over, error: x.error ?? null }
  })
  const l = logs.map((x) => {
    if (!x.error && x.count) alerts++
    return { app: x.app, count: x.count ?? 0, rows: x.rows ?? [], error: x.error ?? null }
  })
  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    summary: { alerts, status: alerts ? 'alert' : 'ok' },
    metrics: m,
    logs: l,
  }
}

// UTC ISO → KST(+9) "YYYY년 MM월 DD일 HH:MM"
function fmtKoreanKst(ts) {
  if (!ts) return ''
  try {
    const base = String(ts).replace('Z', '').split('.')[0]
    const d = new Date(base + 'Z')
    if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
    const kst = new Date(d.getTime() + 9 * 3600 * 1000)
    const p = (n) => String(n).padStart(2, '0')
    return `${kst.getUTCFullYear()}년 ${p(kst.getUTCMonth() + 1)}월 ${p(kst.getUTCDate())}일 ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
  } catch {
    return ''
  }
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
  const tdR = td + ';text-align:right;font-weight:600'
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
    return `<tr><td style="${td}">${icon} ${esc(m.label)}</td><td style="${tdR}">${val}</td><td style="${tdR}">${esc(String(m.threshold))}</td></tr>`
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
