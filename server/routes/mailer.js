// server/routes/mailer.js
import { Router } from 'express'
import db from '../db.js'
import { sendMail } from '../smtp.js'

const router = Router()

const ALLOWED_JOB_PATCH_FIELDS = new Set([
  'name', 'sender', 'sender_account_id', 'subject', 'body',
  'recipients', 'interval_minutes', 'use_index', 'attachments',
  'is_active', 'sort_order',
])

function auth(req, res, next) {
  if (req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// GET /api/mailer/jobs
router.get('/jobs', auth, async (_req, res) => {
  try {
    const { data, error } = await db
      .from('mail_jobs')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mailer/jobs
router.post('/jobs', auth, async (req, res) => {
  const { name, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments } = req.body
  try {
    const { data, error } = await db
      .from('mail_jobs')
      .insert({
        name, sender, subject, body, recipients, interval_minutes,
        sender_account_id: sender_account_id || null,
        use_index: use_index ?? false,
        attachments: attachments ?? [],
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/mailer/jobs/:id
router.patch('/jobs/:id', auth, async (req, res) => {
  const { id } = req.params
  const fields = req.body
  const keys = Object.keys(fields).filter(k => ALLOWED_JOB_PATCH_FIELDS.has(k))
  if (keys.length === 0) return res.status(400).json({ error: 'no valid fields' })

  const updateObj = Object.fromEntries(keys.map(k => [k, fields[k]]))

  try {
    const { data, error } = await db
      .from('mail_jobs')
      .update(updateObj)
      .eq('id', id)
      .select()
    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'not found' })
    res.json(data[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/mailer/jobs/:id
router.delete('/jobs/:id', auth, async (req, res) => {
  const { id } = req.params
  try {
    const { data: job, error: getErr } = await db
      .from('mail_jobs')
      .select('*')
      .eq('id', id)
      .single()
    if (getErr || !job) return res.status(404).json({ error: 'not found' })

    if (job.attachments?.length) {
      await db.storage.from('attachments').remove(job.attachments.map(a => a.path))
    }

    const { error: delErr } = await db.from('mail_jobs').delete().eq('id', id)
    if (delErr) throw delErr
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/mailer/senders
router.get('/senders', auth, async (_req, res) => {
  try {
    const { data, error } = await db
      .from('sender_accounts')
      .select('id, email, created_at')
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mailer/senders
router.post('/senders', auth, async (req, res) => {
  const { email, app_password } = req.body
  try {
    const { data, error } = await db
      .from('sender_accounts')
      .insert({ email, app_password })
      .select('id, email, created_at')
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/mailer/senders/:id
router.delete('/senders/:id', auth, async (req, res) => {
  try {
    const { error } = await db.from('sender_accounts').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mailer/tick — 스케줄러가 호출
router.post('/tick', async (_req, res) => {
  try {
    const now = Date.now()
    const { data: jobs, error } = await db.from('mail_jobs').select('*').eq('is_active', true)
    if (error) throw error

    const due = jobs.filter(job => {
      if (!job.last_sent_at) return true
      return now >= new Date(job.last_sent_at).getTime() + job.interval_minutes * 60_000
    })

    const results = await Promise.allSettled(
      due.map(async (job) => {
        const subject = job.use_index ? `[${job.send_count + 1}] ${job.subject}` : job.subject

        let sendOpts = { sender: job.sender }
        if (job.sender_account_id) {
          const { data: account, error: accErr } = await db
            .from('sender_accounts')
            .select('*')
            .eq('id', job.sender_account_id)
            .single()
          if (accErr || !account) throw new Error(`Sender account not found: ${job.sender_account_id}`)
          sendOpts = { senderEmail: account.email, senderPassword: account.app_password }
        }

        for (const recipient of job.recipients) {
          await sendMail({ ...sendOpts, to: recipient, subject, body: job.body, attachments: job.attachments })
        }

        const { error: updateErr } = await db
          .from('mail_jobs')
          .update({ last_sent_at: new Date().toISOString(), send_count: job.send_count + 1 })
          .eq('id', job.id)
        if (updateErr) throw updateErr
      })
    )

    const failed = results.filter(r => r.status === 'rejected').length
    res.json({ processed: due.length, failed })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
