// server/smtp.js
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function fetchAttachment(path) {
  const supabase = getSupabase()
  const { data, error } = await supabase.storage.from('attachments').download(path)
  if (error || !data) throw new Error(`첨부파일 다운로드 실패: ${path}`)
  const buffer = await data.arrayBuffer()
  return { content: Buffer.from(buffer), contentType: data.type || 'application/octet-stream' }
}

export async function sendMail({ sender, senderEmail, senderPassword, to, subject, body, attachments = [] }) {
  const isGmail = senderEmail ? true : sender === 'gmail'
  const user = senderEmail ?? (isGmail ? process.env.GMAIL_USER : process.env.MS_USER)
  const password = senderPassword ?? (isGmail ? process.env.GMAIL_APP_PASSWORD : process.env.MS_APP_PASSWORD)

  const transporter = nodemailer.createTransport({
    host: isGmail ? 'smtp.gmail.com' : 'smtp-mail.outlook.com',
    port: isGmail ? 465 : 587,
    secure: isGmail,
    auth: { user, pass: password },
  })

  const attachmentList = await Promise.all(
    attachments.map(async (a) => {
      const { content, contentType } = await fetchAttachment(a.path)
      return { filename: a.name, content, contentType }
    })
  )

  await transporter.sendMail({
    from: user,
    to,
    subject,
    text: body,
    ...(attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  })
}
