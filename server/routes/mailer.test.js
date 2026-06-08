// server/routes/mailer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// Supabase 클라이언트 모킹 — from()이 체이닝 빌더를 반환
const mockFrom = vi.hoisted(() => vi.fn())
const mockStorageFrom = vi.hoisted(() => vi.fn())

vi.mock('../db.js', () => ({
  default: {
    from: mockFrom,
    storage: { from: mockStorageFrom },
  },
}))

// 체이닝 빌더 헬퍼: 결과값을 지정하면 then/single 모두 해당 값으로 resolve
function mockQuery(result) {
  const p = Promise.resolve(result)
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve, reject) => p.then(resolve, reject),
  }
  return chain
}

vi.mock('../smtp.js', () => ({ sendMail: vi.fn() }))

const { default: mailerRouter } = await import('./mailer.js')
const app = express()
app.use(express.json())
app.use('/api/mailer', mailerRouter)

const AUTH = { 'x-app-password': 'test-password' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_PASSWORD = 'test-password'
})

describe('GET /api/mailer/jobs', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).get('/api/mailer/jobs')
    expect(res.status).toBe(401)
  })

  it('인증 성공 시 작업 목록 반환', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [{ id: '1', name: 'test' }], error: null }))
    const res = await request(app).get('/api/mailer/jobs').set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: '1', name: 'test' }])
  })
})

describe('POST /api/mailer/jobs', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).post('/api/mailer/jobs').send({ name: 'test' })
    expect(res.status).toBe(401)
  })

  it('작업 생성 후 201 반환', async () => {
    const job = { id: '1', name: 'test', recipients: [], interval_minutes: 60 }
    mockFrom.mockReturnValueOnce(mockQuery({ data: job, error: null }))
    const res = await request(app).post('/api/mailer/jobs').set(AUTH).send(job)
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('test')
  })
})

describe('PATCH /api/mailer/jobs/:id', () => {
  it('인증 없으면 401', async () => {
    const res = await request(app).patch('/api/mailer/jobs/1').send({ name: 'x' })
    expect(res.status).toBe(401)
  })

  it('허용되지 않은 필드만 있으면 400', async () => {
    const res = await request(app).patch('/api/mailer/jobs/1').set(AUTH).send({ id: 'hacked', send_count: 999 })
    expect(res.status).toBe(400)
  })

  it('유효한 필드로 업데이트 성공', async () => {
    const updated = { id: '1', name: 'updated', is_active: false }
    mockFrom.mockReturnValueOnce(mockQuery({ data: [updated], error: null }))
    const res = await request(app).patch('/api/mailer/jobs/1').set(AUTH).send({ name: 'updated', is_active: false })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('updated')
  })
})

describe('DELETE /api/mailer/jobs/:id', () => {
  it('첨부파일 없는 작업 삭제', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: { id: '1', attachments: [] }, error: null }))  // getJob
      .mockReturnValueOnce(mockQuery({ data: null, error: null }))                           // deleteJob
    const res = await request(app).delete('/api/mailer/jobs/1').set(AUTH)
    expect(res.status).toBe(200)
  })
})
