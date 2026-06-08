// src/components/JobModal.jsx
import { useState, useRef } from 'react'
import TagInput from './TagInput.jsx'
import { uploadFile, deleteFile } from '../../lib/storage.js'

export default function JobModal({ job, onSubmit, onClose, loading, senders = [] }) {
  const [name, setName] = useState(job?.name ?? '')
  const [senderAccountId, setSenderAccountId] = useState(job?.sender_account_id ?? '')
  const [subject, setSubject] = useState(job?.subject ?? '')
  const [body, setBody] = useState(job?.body ?? '')
  const [recipients, setRecipients] = useState(job?.recipients ?? [])
  const [intervalValue, setIntervalValue] = useState(() => {
    if (!job) return 60
    return job.interval_minutes >= 60 && job.interval_minutes % 60 === 0
      ? job.interval_minutes / 60
      : job.interval_minutes
  })
  const [intervalUnit, setIntervalUnit] = useState(() => {
    if (!job) return 'hours'
    return job.interval_minutes >= 60 && job.interval_minutes % 60 === 0 ? 'hours' : 'minutes'
  })
  const [useIndex, setUseIndex] = useState(job?.use_index ?? false)
  const [attachments, setAttachments] = useState(job?.attachments ?? [])
  const [folderUuid] = useState(() => job ? null : crypto.randomUUID())
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const initialRef = useRef({
    name: job?.name ?? '',
    senderAccountId: job?.sender_account_id ?? '',
    subject: job?.subject ?? '',
    body: job?.body ?? '',
    recipients: JSON.stringify(job?.recipients ?? []),
    intervalValue: (() => {
      if (!job) return 60
      return job.interval_minutes >= 60 && job.interval_minutes % 60 === 0
        ? job.interval_minutes / 60
        : job.interval_minutes
    })(),
    intervalUnit: (() => {
      if (!job) return 'hours'
      return job.interval_minutes >= 60 && job.interval_minutes % 60 === 0 ? 'hours' : 'minutes'
    })(),
    useIndex: job?.use_index ?? false,
    attachments: JSON.stringify(job?.attachments ?? []),
  })

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files)
    e.target.value = ''
    setUploading(true)
    try {
      const folder = folderUuid ?? job.id
      const results = await Promise.all(
        files.map(file => uploadFile(folder, file).catch(err => { alert(err.message); return null }))
      )
      const uploaded = results.filter(Boolean)
      setAttachments(prev => {
        const existingNames = new Set(prev.map(a => a.name))
        return [...prev, ...uploaded.filter(a => !existingNames.has(a.name))]
      })
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveAttachment = async (attachment) => {
    try {
      await deleteFile(attachment.path)
      setAttachments(prev => prev.filter(a => a.path !== attachment.path))
    } catch (err) {
      alert(err.message)
    }
  }

  const isDirty = () => {
    const init = initialRef.current
    return (
      name !== init.name ||
      senderAccountId !== init.senderAccountId ||
      subject !== init.subject ||
      body !== init.body ||
      JSON.stringify(recipients) !== init.recipients ||
      Number(intervalValue) !== Number(init.intervalValue) ||
      intervalUnit !== init.intervalUnit ||
      useIndex !== init.useIndex ||
      JSON.stringify(attachments) !== init.attachments
    )
  }

  const handleClose = () => {
    if (isDirty() && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return
    onClose()
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const interval_minutes = intervalUnit === 'hours'
      ? Number(intervalValue) * 60
      : Number(intervalValue)
    onSubmit({ name, sender: 'gmail', sender_account_id: senderAccountId || null, subject, body, recipients, interval_minutes, use_index: useIndex, attachments })
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2 className="modal-title">{job ? '작업 수정' : '새 작업'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">작업 이름</label>
            <input
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 주간 리포트 발송"
              required
            />
          </div>

          <div className="form-field">
            <label className="form-label">발신 계정</label>
            {senders.length === 0 ? (
              <p className="form-hint" style={{ color: '#f87171' }}>
                등록된 발신 계정이 없습니다. 발신 계정 탭에서 먼저 추가해주세요.
              </p>
            ) : (
              <div className="sender-select-wrap">
                <select
                  className="sender-select"
                  value={senderAccountId}
                  onChange={e => setSenderAccountId(e.target.value)}
                  required
                >
                  <option value="">계정 선택</option>
                  {senders.map(s => (
                    <option key={s.id} value={s.id}>{s.email}</option>
                  ))}
                </select>
                <span className="sender-select-arrow">▾</span>
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">메일 제목</label>
            <input
              className="form-input"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="메일 제목"
              required
            />
          </div>

          <div className="form-field">
            <label className="form-label">메일 본문</label>
            <textarea
              className="form-textarea"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="메일 내용을 입력하세요"
              required
            />
          </div>

          <div className="form-field">
            <label className="form-label">수신자</label>
            <TagInput values={recipients} onChange={setRecipients} />
          </div>

          <div className="form-field">
            <label className="form-label">첨부파일</label>
            <div className="attachment-list">
              {attachments.map(a => (
                <div key={a.path} className="attachment-item">
                  <span className="attachment-name">{a.name}</span>
                  <span className="attachment-size">({(a.size / 1024 / 1024).toFixed(1)}MB)</span>
                  <button type="button" className="attachment-remove" onClick={() => handleRemoveAttachment(a)}>×</button>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="attachment-add"
              onClick={() => fileInputRef.current.click()}
              disabled={uploading}
            >
              {uploading ? '업로드 중...' : '파일 추가'}
            </button>
          </div>

          <div className="form-field">
            <label className="form-label">발송 간격</label>
            <div className="interval-row">
              <input
                className="form-input"
                type="number"
                min="1"
                value={intervalValue}
                onChange={e => setIntervalValue(e.target.value)}
                required
              />
              <select
                className="form-select"
                value={intervalUnit}
                onChange={e => setIntervalUnit(e.target.value)}
              >
                <option value="minutes">분</option>
                <option value="hours">시간</option>
              </select>
            </div>
          </div>

          <div className="form-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={useIndex}
                onChange={e => setUseIndex(e.target.checked)}
              />
              제목 앞에 순번 추가 <span className="checkbox-hint">(예: [1] 제목, [2] 제목 …)</span>
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={handleClose}>취소</button>
            <button
              type="submit"
              className="modal-submit"
              disabled={loading || recipients.length === 0}
            >
              {loading ? '저장 중...' : (job ? '수정' : '생성')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
