// server/grafana/config.js
// Python STEP 2 이식. 라벨이 다르면 기존 대시보드 패널 쿼리로 교체.

export const METRICS = [
  { label: 'CPU 사용률(최대, %)',
    query: 'max(max_over_time((100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100))[24h:5m]))',
    threshold: 80 },
  { label: '메모리 사용률(최대, %)',
    query: 'max(max_over_time(((1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100)[24h:5m]))',
    threshold: 85 },
  { label: '디스크 사용률(최대, %)',
    query: 'max(max_over_time(((1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes)) * 100)[24h:5m]))',
    threshold: 85 },
  { label: '비정상 상태 Pod 수',
    query: 'max(max_over_time(sum(kube_pod_status_phase{phase=~"Pending|Failed|Unknown"})[24h:5m]))',
    threshold: 0 },
  { label: '최근 24시간 Pod 재시작 횟수',
    query: 'sum(increase(kube_pod_container_status_restarts_total[24h]))',
    threshold: 0 },
]

export const LOG_QUERIES = [
  { label: 'chatbot',  query: 'app.keyword:"chatbot" && error' },
  { label: 'soe',      query: 'app.keyword:"soe" && error' },
  { label: 'c3',       query: 'app.keyword:"c3" && error' },
  { label: 'webhook',  query: 'app.keyword:"webhook" && error' },
  { label: 'docstore', query: 'app.keyword:"docstore" && error' },
]

export const LOG_HOURS = 24
export const LOG_FETCH = 50
export const LOG_SHOW = 5

// 로그 적재 지연 보정 기본값(시간). 설정(log_lag_hours)이 없을 때의 폴백.
export const LOG_INDEX_LAG_HOURS = 3
