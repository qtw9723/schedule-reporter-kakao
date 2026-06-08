// UTC ISO 문자열 → KST(+9) "YYYY-MM-DD HH:MM"
// 서버 server/grafana/report.js의 fmtTimeKst와 동일 로직(프런트 표시용).
export function fmtKst(ts) {
  if (!ts) return ''
  const base = String(ts).replace('Z', '').split('.')[0]
  const d = new Date(base + 'Z')
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
}
