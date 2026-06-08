-- mail_jobs 테이블에 attachments 컬럼 추가
ALTER TABLE mail_jobs
ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Storage 버킷 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT DO NOTHING;

-- RLS 정책: anon 업로드 허용
DO $$ BEGIN
  CREATE POLICY "Allow anon upload"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'attachments');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS 정책: anon 읽기 허용
DO $$ BEGIN
  CREATE POLICY "Allow anon read"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'attachments');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS 정책: anon 삭제 허용
DO $$ BEGIN
  CREATE POLICY "Allow anon delete"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'attachments');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
