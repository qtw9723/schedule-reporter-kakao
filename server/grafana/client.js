// server/grafana/client.js
import { METRICS, LOG_QUERIES, LOG_HOURS, LOG_FETCH, LOG_INDEX_LAG_HOURS } from './config.js'
import { extractPromValue, normalizeEsIndex, parseEsResponses, esLogRange } from './report.js'

const TIMEOUT = 30000

function cfg() {
  const url = (process.env.GRAFANA_URL || '').replace(/\/$/, '')
  const token = process.env.GRAFANA_TOKEN || ''
  if (!url || !token) throw new Error('GRAFANA_URL / GRAFANA_TOKEN 미설정')
  return { url, token }
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${cfg().token}`, ...extra }
}

export async function queryPrometheus(expr) {
  const { url } = cfg()
  const body = {
    from: 'now-5m', to: 'now',
    queries: [{ refId: 'A', datasource: { uid: process.env.PROM_UID }, expr, instant: true }],
  }
  const r = await fetch(`${url}/api/ds/query`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`prometheus ${r.status}`)
  return extractPromValue(await r.json())
}

export async function getEsIndexAndTimeField(uid) {
  const { url } = cfg()
  const r = await fetch(`${url}/api/datasources/uid/${uid}`, {
    headers: headers(), signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`es datasource ${r.status}`)
  const ds = await r.json()
  const jd = ds.jsonData || {}
  return {
    index: normalizeEsIndex(jd.index || ds.database || '*'),
    timefield: jd.timeField || '@timestamp',
  }
}

export async function queryElasticsearch(queries, hours, fetchSize, lagHours = 0) {
  const { url } = cfg()
  const uid = process.env.ES_UID
  const { index, timefield } = await getEsIndexAndTimeField(uid)
  const range = esLogRange(hours, lagHours)
  const nd = []
  for (const lq of queries) {
    nd.push(JSON.stringify({ index, ignore_unavailable: true }))
    nd.push(JSON.stringify({
      size: fetchSize,
      track_total_hits: true,
      sort: [{ [timefield]: { order: 'desc' } }],
      query: { bool: {
        must: [{ query_string: { query: lq.query } }],
        filter: [{ range: { [timefield]: range } }],
      } },
    }))
  }
  const payload = nd.join('\n') + '\n'
  const r = await fetch(`${url}/api/datasources/proxy/uid/${uid}/_msearch`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/x-ndjson' }),
    body: payload,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`elasticsearch ${r.status}`)
  const json = await r.json()
  return parseEsResponses(json.responses || [], queries, timefield)
}

// 메트릭/로그를 모두 조회해 buildReport 입력 형태로 반환. 개별 실패는 격리.
export async function gatherReportData(lagHours = LOG_INDEX_LAG_HOURS) {
  const metrics = await Promise.all(METRICS.map(async (m) => {
    try {
      const value = await queryPrometheus(m.query)
      return { label: m.label, value, threshold: m.threshold, error: value == null ? '데이터 없음' : null }
    } catch {
      return { label: m.label, value: null, threshold: m.threshold, error: '조회 실패' }
    }
  }))

  let logs
  try {
    const res = await queryElasticsearch(LOG_QUERIES, LOG_HOURS, LOG_FETCH, lagHours)
    logs = LOG_QUERIES.map((lq) => ({
      app: lq.label,
      count: res[lq.label]?.count ?? 0,
      rows: res[lq.label]?.rows ?? [],
      error: null,
    }))
  } catch {
    logs = LOG_QUERIES.map((lq) => ({ app: lq.label, count: 0, rows: [], error: '조회 실패' }))
  }

  return { metrics, logs }
}
