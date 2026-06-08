// src/lib/api/mailer.js
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request(method, path, body = null, password) {
  const res = await fetch(`${BASE}/api/mailer${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-app-password': password ?? '',
    },
    body: body ? JSON.stringify(body) : null,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (method === 'DELETE') return null
  return res.json()
}

export const getJobs = (pw) => request('GET', '/jobs', null, pw)
export const createJob = (job, pw) => request('POST', '/jobs', job, pw)
export const updateJob = (id, patch, pw) => request('PATCH', `/jobs/${id}`, patch, pw)
export const deleteJob = (id, pw) => request('DELETE', `/jobs/${id}`, null, pw)
export const reorderJobs = (ids, pw) =>
  Promise.all(ids.map((id, i) => request('PATCH', `/jobs/${id}`, { sort_order: i }, pw)))

export const getSenders = (pw) => request('GET', '/senders', null, pw)
export const createSender = (data, pw) => request('POST', '/senders', data, pw)
export const deleteSender = (id, pw) => request('DELETE', `/senders/${id}`, null, pw)
