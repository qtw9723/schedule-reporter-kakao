# Schedule Reporter Kakao

카카오톡 플레이 MCP의 스케줄 기능을 자체 서버로 마이그레이션하는 프로젝트입니다.

## 프로젝트 구조

- **Frontend**: React + Vite (Vercel 배포)
- **Backend**: Node.js/Express + Supabase
- **Database**: Supabase (PostgreSQL)
- **Scheduling**: Grafana 리포트 자동화 (일일 보고, 주간보고)

## 설치 및 실행

```bash
npm install
npm run dev          # 프론트 + 백엔드 동시 실행
npm run dev:client   # 프론트만 실행
npm run dev:server   # 백엔드만 실행
npm run build        # 프로덕션 빌드
npm test             # 테스트 실행
```

## 환경 변수

`.env.example`을 참고하여 `.env` 파일을 작성하세요.

## 마이그레이션 체크리스트

- [ ] Supabase 연동 (같은 프로젝트 ref 사용)
- [ ] 스케줄 설정 마이그레이션
- [ ] 이메일 템플릿 설정
- [ ] Vercel 배포 설정
