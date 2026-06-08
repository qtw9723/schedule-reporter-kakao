ALTER TABLE mail_jobs ADD COLUMN IF NOT EXISTS sort_order INT;

UPDATE mail_jobs SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) - 1 AS rn
  FROM mail_jobs
) sub
WHERE mail_jobs.id = sub.id;