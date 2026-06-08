-- grafana_report_settings: 일일 리포트 발송 설정 (싱글톤, id=1)
-- updated_at은 앱 레이어(server/grafana/settings.js의 saveSettings)에서 수동 갱신한다 → DB 트리거 불필요.
-- created_at은 두지 않는다: 마이그레이션 시점에 1회 생성되고 이후 갱신만 되는 싱글톤 설정 행이라 불필요(YAGNI).
CREATE TABLE IF NOT EXISTS grafana_report_settings (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  recipients     TEXT[]      NOT NULL DEFAULT '{}',
  send_hour      SMALLINT    NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  last_sent_date DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- enabled=true인데 recipients가 비어도 허용한다: tick이 env GRAFANA_EMAIL_TO로 폴백하고, 그래도 없으면 no-recipients로 skip.
INSERT INTO grafana_report_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
