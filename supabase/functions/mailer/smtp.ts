// supabase/functions/mailer/smtp.ts
import nodemailer from "npm:nodemailer@6"
import { createClient } from "jsr:@supabase/supabase-js@2"

interface Attachment {
  path: string
  name: string
  size: number
}

interface SendOptions {
  sender?: "gmail" | "ms"
  senderEmail?: string
  senderPassword?: string
  to: string
  subject: string
  body: string
  attachments?: Attachment[]
}

async function fetchAttachment(path: string): Promise<{ content: Uint8Array; contentType: string }> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )
  const { data, error } = await supabase.storage.from("attachments").download(path)
  if (error || !data) throw new Error(`첨부파일 다운로드 실패: ${path}`)
  const buffer = await data.arrayBuffer()
  return { content: new Uint8Array(buffer), contentType: data.type || "application/octet-stream" }
}

export async function sendMail(opts: SendOptions): Promise<void> {
  const isGmail = opts.senderEmail ? true : opts.sender === "gmail"
  const user = opts.senderEmail ?? (isGmail ? Deno.env.get("GMAIL_USER")! : Deno.env.get("MS_USER")!)
  const password = opts.senderPassword ?? (isGmail ? Deno.env.get("GMAIL_APP_PASSWORD")! : Deno.env.get("MS_APP_PASSWORD")!)

  const transporter = nodemailer.createTransport({
    host: isGmail ? "smtp.gmail.com" : "smtp-mail.outlook.com",
    port: isGmail ? 465 : 587,
    secure: isGmail,
    auth: { user, pass: password },
  })

  const attachments = await Promise.all(
    (opts.attachments ?? []).map(async (a) => {
      const { content, contentType } = await fetchAttachment(a.path)
      return { filename: a.name, content, contentType }
    })
  )

  await transporter.sendMail({
    from: user,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    ...(attachments.length > 0 ? { attachments } : {}),
  })
}
