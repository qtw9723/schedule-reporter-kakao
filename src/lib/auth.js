export const COOKIE_NAME = 'smarthub-password'
const COOKIE_DAYS = 100

export function getCookie() {
  const match = document.cookie.split('; ').find(r => r.startsWith(COOKIE_NAME + '='))
  return match ? decodeURIComponent(match.split('=')[1]) : ''
}

export function setCookie(value) {
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`
}

export function clearCookie() {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`
}
