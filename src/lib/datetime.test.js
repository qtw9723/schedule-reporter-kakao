import { describe, it, expect } from 'vitest'
import { fmtKst } from './datetime.js'

describe('fmtKst', () => {
  it('UTC 00:00 → KST 09:00', () => {
    expect(fmtKst('2026-06-05T00:00:00.000Z')).toBe('2026-06-05 09:00')
  })
  it('자정 경계: UTC 23:30 → KST 다음날 08:30', () => {
    expect(fmtKst('2026-06-05T23:30:00Z')).toBe('2026-06-06 08:30')
  })
  it('빈 값/널은 빈 문자열', () => {
    expect(fmtKst('')).toBe('')
    expect(fmtKst(null)).toBe('')
    expect(fmtKst(undefined)).toBe('')
  })
})
