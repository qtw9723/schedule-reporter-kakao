import { Trash2 } from 'lucide-react'

export default function SenderPage({ senders, onDelete }) {
  return (
    <div className="sender-page">
      {senders.length === 0 ? (
        <p className="job-empty">등록된 발신 계정이 없습니다.</p>
      ) : (
        <div className="sender-list">
          {senders.map(s => (
            <div key={s.id} className="sender-card">
              <div className="sender-icon">G</div>
              <div className="sender-info">
                <div className="sender-email">{s.email}</div>
                <div className="sender-meta">앱 비밀번호 ••••••••••••••••</div>
              </div>
              <button
                className="btn btn-delete"
                onClick={() => onDelete(s.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
