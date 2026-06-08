import { describe, it, expect, beforeEach } from 'vitest'
import { getCookie, setCookie, clearCookie, COOKIE_NAME } from './auth.js'

beforeEach(() => {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
})

describe('getCookie', () => {
  it('쿠키가 없으면 빈 문자열 반환', () => {
    expect(getCookie()).toBe('')
  })
  it('setCookie 후 getCookie로 값 읽기', () => {
    setCookie('secret123')
    expect(getCookie()).toBe('secret123')
  })
})

describe('clearCookie', () => {
  it('clearCookie 후 getCookie는 빈 문자열', () => {
    setCookie('secret123')
    clearCookie()
    expect(getCookie()).toBe('')
  })
})
