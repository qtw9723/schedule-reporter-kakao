import db from '../db.js'

const TABLE = 'grafana_report_settings'
const SINGLETON_ID = 1

// 싱글톤 행 조회. 없으면 기본값으로 생성 후 반환.
export async function getSettings() {
  const { data, error } = await db.from(TABLE).select('*').eq('id', SINGLETON_ID).maybeSingle()
  if (error) throw error
  if (data) return data

  const { data: created, error: insErr } = await db
    .from(TABLE)
    .insert({ id: SINGLETON_ID })
    .select('*')
    .single()
  if (insErr) throw insErr
  return created
}

// recipients/send_hour/enabled/log_lag_hours 저장.
export async function saveSettings({ recipients, send_hour, enabled, log_lag_hours }) {
  const { data, error } = await db
    .from(TABLE)
    .update({ recipients, send_hour, enabled, log_lag_hours, updated_at: new Date().toISOString() })
    .eq('id', SINGLETON_ID)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// 발송 성공 후 마지막 발송 날짜 기록.
export async function markSent(dateStr) {
  const { error } = await db
    .from(TABLE)
    .update({ last_sent_date: dateStr })
    .eq('id', SINGLETON_ID)
  if (error) throw error
}
