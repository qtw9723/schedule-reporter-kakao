// src/lib/api/grafana.js
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export async function getReport(password) {
  const res = await fetch(`${BASE}/api/grafana/report`, {
    headers: { 'x-app-password': password ?? '' },
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function getSettings(password) {
  const res = await fetch(`${BASE}/api/grafana/settings`, {
    headers: { 'x-app-password': password ?? '' },
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}

export async function updateSettings(body, password) {
  const res = await fetch(`${BASE}/api/grafana/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-app-password': password ?? '' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}
