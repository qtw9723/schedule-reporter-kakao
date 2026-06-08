// Vercel Serverless Function 진입점.
// Express 앱을 그대로 핸들러로 사용한다. /api/* 요청은 vercel.json rewrite로 이 함수에 라우팅되며,
// req.url에는 원래 경로(/api/mailer/jobs 등)가 그대로 들어와 Express 라우터가 매칭한다.
export { default } from '../server/index.js'
