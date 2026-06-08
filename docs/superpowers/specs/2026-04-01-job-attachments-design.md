# Job Attachments Design

**Goal:** 각 작업(Job)에 여러 파일을 첨부해두고, 스케줄 발송 시 매번 첨부파일이 포함되어 전송된다.

## Requirements

- 작업당 여러 파일 첨부 가능
- 파일 1개당 최대 10MB
- 작업 생성/수정 시 파일 추가 및 제거 가능
- 작업 삭제 시 연결된 Storage 파일도 함께 삭제
- 스케줄 발송(tick)마다 첨부파일 포함하여 전송

## Data Model

`jobs` 테이블에 `attachments` JSONB 컬럼 추가:

```json
[
  { "path": "attachments/{folder_uuid}/{filename}", "name": "파일명.pdf", "size": 1234567 }
]
```

- `path`: Supabase Storage 내 파일 경로
- `name`: 원본 파일명 (메일 첨부파일명으로 사용)
- `size`: 바이트 단위 크기

## Storage

- 버킷: `attachments`
- 업로드 경로: `attachments/{folder_uuid}/{filename}`
  - `folder_uuid`는 프론트엔드에서 작업별로 생성한 UUID
  - job_id를 쓰지 않는 이유: 신규 작업은 저장 전 job_id가 없음
- 버킷 RLS: anon 업로드/삭제 허용 (앱 레벨 패스워드로 접근 제어)
- Edge Function은 service_role 키로 파일 다운로드/삭제

## Frontend Flow

1. JobModal에서 파일 선택 → 10MB 초과 시 즉시 차단
2. 파일 선택 시 Supabase Storage에 즉시 업로드
3. 업로드 완료된 파일 목록 표시 (이름, 크기, 삭제 버튼)
4. 작업 저장 시 파일 경로 목록을 API에 함께 전달
5. 수정 시: 기존 첨부파일 표시, 추가/삭제 가능

## Backend Flow

### 발송 (tick)
1. getDueJobs()로 jobs + attachments 조회
2. 각 파일 경로에서 Storage 다운로드
3. denomailer attachments 필드로 전달

### 삭제 (DELETE /jobs)
1. DB에서 job의 attachments 경로 목록 조회
2. Storage에서 파일 삭제
3. DB에서 job 삭제
