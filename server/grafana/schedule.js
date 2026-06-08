// KST = UTC+9, DST 없음. UTC Date에 9시간 더해 KST 시계값을 구한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function toKst(date) {
  return new Date(date.getTime() + KST_OFFSET_MS)
}

export function kstHour(date) {
  return toKst(date).getUTCHours()
}

export function kstDateString(date) {
  return toKst(date).toISOString().slice(0, 10)
}

export function shouldSend(settings, now) {
  if (!settings.enabled) return { send: false, reason: 'disabled' }
  if (kstHour(now) !== settings.send_hour) return { send: false, reason: 'not-time' }
  if (settings.last_sent_date === kstDateString(now)) return { send: false, reason: 'already-sent' }
  return { send: true, reason: 'ok' }
}
