-- sender_accounts 테이블
CREATE TABLE sender_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  app_password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- mail_jobs에 FK 추가
ALTER TABLE mail_jobs
ADD COLUMN IF NOT EXISTS sender_account_id UUID
  REFERENCES sender_accounts(id) ON DELETE SET NULL;
