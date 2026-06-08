-- grafana_report_settings에 로그 적재 지연 보정(시간) 컬럼 추가. 기본 3, 기존 행은 자동 3 백필.
ALTER TABLE grafana_report_settings
  ADD COLUMN IF NOT EXISTS log_lag_hours SMALLINT NOT NULL DEFAULT 3
  CHECK (log_lag_hours BETWEEN 0 AND 24);
