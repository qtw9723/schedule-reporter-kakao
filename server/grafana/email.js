// server/grafana/email.js
import nodemailer from 'nodemailer'

export async function sendReportEmail(html, recipients) {
  const from = process.env.GRAFANA_EMAIL_FROM
  const pass = process.env.GRAFANA_EMAIL_PASSWORD
  if (!from || !pass) throw new Error('GRAFANA_EMAIL_FROM/PASSWORD 미설정')

  const to = (recipients ?? []).map((s) => String(s).trim()).filter(Boolean)
  if (to.length === 0) throw new Error('수신자가 없습니다')

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: from, pass },
  })
  await transporter.sendMail({
    from,
    to,
    subject: '[Next-TI 운영] 그라파나 모니터링 보고서',
    html,
  })
}
