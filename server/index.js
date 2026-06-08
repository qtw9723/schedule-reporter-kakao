// server/index.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mailerRouter from './routes/mailer.js'
import grafanaRouter from './routes/grafana.js'
import chatbotRouter from './routes/chatbot.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: 'http://localhost:5173', credentials: true }))
app.use(express.json())

app.use('/api/mailer', mailerRouter)
app.use('/api/grafana', grafanaRouter)
app.use('/api/chatbot', chatbotRouter)

// Vercel(서버리스)에서는 포트 바인딩 없이 app을 핸들러로 export.
// 로컬/상시구동 환경에서만 listen.
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`CS SmartHub server running on :${PORT}`))
}

export default app
