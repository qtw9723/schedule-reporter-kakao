// server/grafana/report.test.js
import { describe, it, expect } from 'vitest'
import {
  extractPromValue, normalizeEsIndex, fmtTimeKst, parseEsResponses, buildReport, buildEmailHtml, esLogRange,
} from './report.js'

describe('extractPromValue', () => {
  it('frames의 마지막 값 추출', () => {
    const resp = { results: { A: { frames: [{ data: { values: [[1700000000000], [13.7]] } }] } } }
    expect(extractPromValue(resp)).toBe(13.7)
  })
  it('frames 없으면 null', () => {
    expect(extractPromValue({ results: { A: { frames: [] } } })).toBeNull()
    expect(extractPromValue({})).toBeNull()
  })
})

describe('normalizeEsIndex', () => {
  it('[prefix]날짜 템플릿 → prefix*', () => {
    expect(normalizeEsIndex('[out_logs-]YYYY.MM.DD')).toBe('out_logs-*')
  })
  it('일반 문자열은 그대로', () => {
    expect(normalizeEsIndex('logs-*')).toBe('logs-*')
  })
})

describe('fmtTimeKst', () => {
  it('UTC ISO → KST(+9) YYYY-MM-DD HH:MM', () => {
    expect(fmtTimeKst('2026-06-03T07:37:49.123Z')).toBe('2026-06-03 16:37')
  })
  it('빈 값은 빈 문자열', () => {
    expect(fmtTimeKst('')).toBe('')
  })
})

describe('parseEsResponses', () => {
  it('앱별 count와 rows 파싱', () => {
    const responses = [
      { hits: { total: { value: 2 }, hits: [
        { _source: { '@timestamp': '2026-06-03T07:37:49Z', message: 'boom' } },
      ] } },
      { hits: { total: { value: 0 }, hits: [] } },
    ]
    const queries = [{ label: 'soe' }, { label: 'c3' }]
    const out = parseEsResponses(responses, queries, '@timestamp')
    expect(out.soe.count).toBe(2)
    expect(out.soe.rows[0]).toEqual({ time: '2026-06-03 16:37', msg: 'boom' })
    expect(out.c3.count).toBe(0)
  })
  it('message 없으면 log→msg 순으로 폴백', () => {
    const responses = [{ hits: { total: { value: 1 }, hits: [{ _source: { '@timestamp': '', log: 'fromlog' } }] } }]
    const out = parseEsResponses(responses, [{ label: 'x' }], '@timestamp')
    expect(out.x.rows[0].msg).toBe('fromlog')
  })
})

describe('buildReport', () => {
  const base = {
    generatedAt: '2026-06-05T00:00:00.000Z',
    metrics: [
      { label: 'CPU', value: 13.7, threshold: 80, error: null },
      { label: 'MEM', value: 90, threshold: 85, error: null },
      { label: 'DISK', value: null, threshold: 85, error: '데이터 없음' },
    ],
    logs: [
      { app: 'soe', count: 1, rows: [], error: null },
      { app: 'c3', count: 0, rows: [], error: null },
    ],
  }
  it('임계 초과 메트릭 + 로그 1건 이상을 alerts로 합산', () => {
    const r = buildReport(base)
    expect(r.summary.alerts).toBe(2) // MEM 초과 + soe 1건
    expect(r.summary.status).toBe('alert')
  })
  it('over 플래그 계산', () => {
    const r = buildReport(base)
    expect(r.metrics.find(m => m.label === 'CPU').over).toBe(false)
    expect(r.metrics.find(m => m.label === 'MEM').over).toBe(true)
    expect(r.metrics.find(m => m.label === 'DISK').over).toBe(false)
  })
  it('이상 0건이면 status ok', () => {
    const r = buildReport({ generatedAt: 'x', metrics: [{ label: 'CPU', value: 1, threshold: 80, error: null }], logs: [] })
    expect(r.summary).toEqual({ alerts: 0, status: 'ok' })
  })
})

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
    // 로그 테이블은 시간/메시지 헤더로 식별됨 — 에러 그룹이면 렌더되지 않아야 함 (리소스 테이블의 항목/값/임계 헤더는 별개로 존재)
    expect(html).not.toContain('>시간<')
  })

  it('메트릭 에러는 ○ 아이콘과 에러문구 표기', () => {
    const html = buildEmailHtml(baseReport({ metrics: [{ label: 'CPU', value: null, threshold: 80, error: 'PromQL 오류' }] }))
    expect(html).toContain('○')
    expect(html).toContain('PromQL 오류')
  })

  it('메시지를 HTML 이스케이프', () => {
    const html = buildEmailHtml(baseReport({ logs: [{ app: 'soe', count: 1, rows: [{ time: 't', msg: '<script>x</script>' }], error: null }] }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x')
  })
})

describe('esLogRange', () => {
  it('lagHours=0이면 now-24h ~ now', () => {
    expect(esLogRange(24, 0)).toEqual({ gte: 'now-24h', lte: 'now' })
  })
  it('lagHours=3이면 now-27h ~ now-3h', () => {
    expect(esLogRange(24, 3)).toEqual({ gte: 'now-27h', lte: 'now-3h' })
  })
  it('lagHours 기본값은 0', () => {
    expect(esLogRange(24)).toEqual({ gte: 'now-24h', lte: 'now' })
  })
  it('lagHours=24면 now-48h ~ now-24h', () => {
    expect(esLogRange(24, 24)).toEqual({ gte: 'now-48h', lte: 'now-24h' })
  })
})
