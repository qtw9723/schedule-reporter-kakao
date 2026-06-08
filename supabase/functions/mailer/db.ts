// supabase/functions/mailer/db.ts
import { createClient } from "jsr:@supabase/supabase-js@2"

export interface MailJob {
  id: string
  name: string
  subject: string
  body: string
  recipients: string[]
  sender: "gmail" | "ms"
  sender_account_id: string | null
  interval_minutes: number
  is_active: boolean
  last_sent_at: string | null
  send_count: number
  use_index: boolean
  attachments: { path: string; name: string; size:number }[]  // 추가
  created_at: string
}

function getDb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
}

export async function listJobs(): Promise<MailJob[]> {
  const db = getDb()
  const { data, error } = await db
    .from("mail_jobs")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createJob(job: Omit<MailJob, "id" | "is_active" | "last_sent_at" | "send_count" | "created_at">): Promise<MailJob> {
  const db = getDb()
  const { data, error } = await db
    .from("mail_jobs")
    .insert(job)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateJob(id: string, patch: Partial<MailJob>): Promise<MailJob> {
  const db = getDb()
  const { data, error } = await db
    .from("mail_jobs")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteJob(id: string): Promise<void> {
  const db = getDb()
  const { error } = await db.from("mail_jobs").delete().eq("id", id)
  if (error) throw error
}

export async function getDueJobs(): Promise<MailJob[]> {
  const db = getDb()
  const { data, error } = await db
    .from("mail_jobs")
    .select("*")
    .eq("is_active", true)
  if (error) throw error
  const now = Date.now()
  return (data ?? []).filter((job: MailJob) => {
    if (!job.last_sent_at) return true
    return now >= new Date(job.last_sent_at).getTime() + job.interval_minutes * 60_000
  })
}

export async function markSent(id: string, currentCount: number): Promise<void> {
  const db = getDb()
  const { error } = await db
    .from("mail_jobs")
    .update({
      last_sent_at: new Date().toISOString(),
      send_count: currentCount + 1,
    })
    .eq("id", id)
  if (error) throw error
}

export async function getJob(id: string): Promise<MailJob | null> {
  const db = getDb()
  const { data, error } = await db
    .from("mail_jobs")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data
}

export interface SenderAccount {
  id: string
  email: string
  app_password: string
  created_at: string
}

export async function getSenderAccounts(): Promise<Omit<SenderAccount, 'app_password'>[]> {
  const db = getDb()
  const { data, error } = await db
    .from("sender_accounts")
    .select("id, email, created_at")
    .order("created_at", { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createSenderAccount(
  account: Pick<SenderAccount, 'email' | 'app_password'>
): Promise<Omit<SenderAccount, 'app_password'>> {
  const db = getDb()
  const { data, error } = await db
    .from("sender_accounts")
    .insert(account)
    .select("id, email, created_at")
    .single()
  if (error) throw error
  return data
}

export async function deleteSenderAccount(id: string): Promise<void> {
  const db = getDb()
  const { error } = await db.from("sender_accounts").delete().eq("id", id)
  if (error) throw error
}

export async function getSenderAccountById(id: string): Promise<SenderAccount | null> {
  const db = getDb()
  const { data, error } = await db
    .from("sender_accounts")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data
}