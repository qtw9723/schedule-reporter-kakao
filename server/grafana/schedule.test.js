import { describe, it, expect } from 'vitest'
import { kstHour, kstDateString, shouldSend } from './schedule.js'

describe('kstHour', () => {
  it('UTC 00:00 → KST 9시', () => {
    expect(kstHour(new Date('2026-06-05T00:00:00Z'))).toBe(9)
  })
  it('UTC 15:30 → KST 0시(다음날)', () => {
    expect(kstHour(new Date('2026-06-05T15:30:00Z'))).toBe(0)
  })
})

describe('kstDateString', () => {
  it('UTC 23:00 → KST 다음날 날짜', () => {
    expect(kstDateString(new Date('2026-06-05T23:00:00Z'))).toBe('2026-06-06')
  })
  it('UTC 00:00 → 같은 날 KST 09시', () => {
    expect(kstDateString(new Date('2026-06-05T00:00:00Z'))).toBe('2026-06-05')
  })
})

describe('shouldSend', () => {
  const now = new Date('2026-06-05T00:00:00Z') // KST 9시, 날짜 2026-06-05
  it('enabled=false면 disabled', () => {
    expect(shouldSend({ enabled: false, send_hour: 9, last_sent_date: null }, now))
      .toEqual({ send: false, reason: 'disabled' })
  })
  it('시각 불일치면 not-time', () => {
    expect(shouldSend({ enabled: true, send_hour: 10, last_sent_date: null }, now))
      .toEqual({ send: false, reason: 'not-time' })
  })
  it('오늘 이미 보냈으면 already-sent', () => {
    expect(shouldSend({ enabled: true, send_hour: 9, last_sent_date: '2026-06-05' }, now))
      .toEqual({ send: false, reason: 'already-sent' })
  })
  it('조건 충족 시 ok', () => {
    expect(shouldSend({ enabled: true, send_hour: 9, last_sent_date: '2026-06-04' }, now))
      .toEqual({ send: true, reason: 'ok' })
  })
})
