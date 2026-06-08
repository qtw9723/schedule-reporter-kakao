// supabase/functions/mailer/index.ts
import {
  listJobs, createJob, updateJob, deleteJob,
  getJob, getDueJobs, markSent,
  getSenderAccounts, createSenderAccount, deleteSenderAccount, getSenderAccountById
} from "./db.ts"
import { sendMail } from "./smtp.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-password",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  })
}

function checkAppPassword(req: Request): boolean {
  return req.headers.get("x-app-password") === Deno.env.get("APP_PASSWORD")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get("action")
    const id = url.searchParams.get("id")
    const resource = url.searchParams.get("resource")

    // POST ?action=tick — pg_cron 호출 (APP_PASSWORD 검증 불필요)
    if (req.method === "POST" && action === "tick") {
      const jobs = await getDueJobs()
      const results = await Promise.allSettled(
        jobs.map(async (job) => {
          const subject = job.use_index ? `[${job.send_count + 1}] ${job.subject}` : job.subject

          const sendOpts = job.sender_account_id
            ? await (async () => {
                const account = await getSenderAccountById(job.sender_account_id!)
                if (!account) throw new Error(`Sender account not found: ${job.sender_account_id}`)
                return { senderEmail: account.email, senderPassword: account.app_password }
              })()
            : { sender: job.sender }

          for (const recipient of job.recipients) {
            await sendMail({ ...sendOpts, to: recipient, subject, body: job.body, attachments: job.attachments })
          }
          await markSent(job.id, job.send_count)
        })
      )
      results.forEach((r, i) => {
        if (r.status === "rejected") console.error(`Job ${jobs[i].id} failed:`, r.reason)
      })
      const failed = results.filter(r => r.status === "rejected").length
      return json({ processed: jobs.length, failed })
    }

    // CRUD — APP_PASSWORD 필수
    if (!checkAppPassword(req)) return json({ error: "unauthorized" }, 401)

    // Senders CRUD
    if (resource === "senders") {
      if (req.method === "GET") {
        return json(await getSenderAccounts())
      }
      if (req.method === "POST") {
        const body = await req.json()
        return json(await createSenderAccount(body), 201)
      }
      if (req.method === "DELETE") {
        if (!id) return json({ error: "id required" }, 400)
        await deleteSenderAccount(id)
        return json({ success: true })
      }
    }

    // GET — 작업 목록
    if (req.method === "GET") {
      return json(await listJobs())
    }

    // POST — 작업 생성
    if (req.method === "POST") {
      const body = await req.json()
      return json(await createJob(body), 201)
    }

    // PATCH ?id= — 작업 수정
    if (req.method === "PATCH") {
      if (!id) return json({ error: "id required" }, 400)
      const body = await req.json()
      return json(await updateJob(id, body))
    }

      // DELETE ?id= — 작업 삭제
      if (req.method === "DELETE") {                  
        if (!id) return json({ error: "id required" },
   400)                                               
                                                    
        const job = await getJob(id)       
        if (job?.attachments?.length) {    
          const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,            
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
          )                                           
          const paths = job.attachments.map((a) =>  
  a.path)                                  
          await                            
  supabase.storage.from("attachments").remove(paths)
        }                                             
                                
        await deleteJob(id)                           
        return json({ success: true })              
      }
                          
      

    return json({ error: "not found" }, 404)
  } catch (e) {
    console.error("mailer error:", e)
    return json({ error: "internal server error", details: e.message }, 500)
  }
})
