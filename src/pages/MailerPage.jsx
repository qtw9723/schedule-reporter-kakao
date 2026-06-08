// src/pages/MailerPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { getJobs, createJob, updateJob, deleteJob, reorderJobs, getSenders, createSender, deleteSender } from '../lib/api/mailer.js'
import { getCookie, clearCookie } from '../lib/auth.js'
import JobCard from '../components/mailer/JobCard.jsx'
import JobModal from '../components/mailer/JobModal.jsx'
import SenderPage from '../components/mailer/SenderPage.jsx'
import SenderModal from '../components/mailer/SenderModal.jsx'
import AppHeader from '../components/shared/AppHeader.jsx'

export default function MailerPage() {
  const navigate = useNavigate()
  const password = getCookie()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editJob, setEditJob] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [page, setPage] = useState('jobs')
  const [senders, setSenders] = useState([])
  const [showSenderModal, setShowSenderModal] = useState(false)
  const pollRef = useRef(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const refreshJobs = useCallback(async () => {
    try {
      const data = await getJobs(password)
      setJobs(data.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') {
        clearCookie()
        navigate('/login')
      }
    }
  }, [password, navigate])

  const loadSenders = useCallback(async () => {
    try { setSenders(await getSenders(password)) } catch { /* 발신 계정 로드는 best-effort */ }
  }, [password])

  useEffect(() => {
    refreshJobs()
    loadSenders()
    pollRef.current = setInterval(refreshJobs, 60_000)
    return () => clearInterval(pollRef.current)
  }, [refreshJobs, loadSenders])

  const handleCreate = async (formData) => {
    setLoading(true)
    try {
      const job = await createJob(formData, password)
      setJobs(prev => [job, ...prev])
      setShowModal(false)
    } finally { setLoading(false) }
  }

  const handleUpdate = async (id, patch) => {
    const job = await updateJob(id, patch, password)
    setJobs(prev => prev.map(j => j.id === id ? job : j))
    setEditJob(null)
    setShowModal(false)
  }

  const handleDelete = async (id) => {
    await deleteJob(id, password)
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  const handleResetCount = async (id) => {
    if (!confirm('순번을 0으로 초기화할까요?')) return
    const job = await updateJob(id, { send_count: 0 }, password)
    setJobs(prev => prev.map(j => j.id === id ? job : j))
  }

  const handleDuplicate = async (job) => {
    const { name, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments } = job
    const match = name.match(/^\[(\d+)\] (.+)$/)
    const newName = match ? `[${Number(match[1]) + 1}] ${match[2]}` : `[0] ${name}`
    const newJob = await createJob({ name: newName, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments }, password)
    setJobs(prev => [newJob, ...prev])
  }

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    setJobs(prev => {
      const oldIndex = prev.findIndex(j => j.id === active.id)
      const newIndex = prev.findIndex(j => j.id === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      reorderJobs(reordered.map(j => j.id), password)
      return reordered
    })
  }

  const handleDeleteSelected = async () => {
    await Promise.all([...selectedIds].map(id => deleteJob(id, password)))
    setJobs(prev => prev.filter(j => !selectedIds.has(j.id)))
    setSelectedIds(new Set())
  }

  const handleCreateSender = async (data) => {
    const sender = await createSender(data, password)
    setSenders(prev => [...prev, sender])
    setShowSenderModal(false)
  }

  const handleDeleteSender = async (id) => {
    if (!confirm('발신 계정을 삭제할까요?')) return
    await deleteSender(id, password)
    setSenders(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="app">
      <AppHeader toolName="Mailer">
        {page === 'jobs' ? (
          <button className="app-new-btn" onClick={() => { setEditJob(null); setShowModal(true) }}>
            <Plus size={14} /> 새 작업
          </button>
        ) : (
          <button className="app-new-btn" onClick={() => setShowSenderModal(true)}>
            <Plus size={14} /> 계정 추가
          </button>
        )}
      </AppHeader>

      <nav className="nav-tabs" style={{ padding: '0 24px' }}>
        <button className={`nav-tab${page === 'jobs' ? ' active' : ''}`} onClick={() => setPage('jobs')}>스케줄</button>
        <button className={`nav-tab${page === 'senders' ? ' active' : ''}`} onClick={() => setPage('senders')}>발신 계정</button>
      </nav>

      {page === 'jobs' ? (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
              <div className="job-list">
                {jobs.length > 0 && (
                  <div className="bulk-bar">
                    <label className="bulk-select-all">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === jobs.length}
                        onChange={e => setSelectedIds(e.target.checked ? new Set(jobs.map(j => j.id)) : new Set())}
                      />
                      전체 선택
                    </label>
                    {selectedIds.size > 0 && (
                      <button className="bulk-delete-btn" onClick={handleDeleteSelected}>
                        <Trash2 size={12} /> {selectedIds.size}개 삭제
                      </button>
                    )}
                  </div>
                )}
                {jobs.length === 0 ? (
                  <p className="job-empty">작업이 없습니다. 새 작업을 만들어보세요.</p>
                ) : (
                  jobs.map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      senders={senders}
                      selected={selectedIds.has(job.id)}
                      onSelect={checked => setSelectedIds(prev => {
                        const s = new Set(prev)
                        checked ? s.add(job.id) : s.delete(job.id)
                        return s
                      })}
                      onToggle={() => handleUpdate(job.id, { is_active: !job.is_active })}
                      onEdit={() => { setEditJob(job); setShowModal(true) }}
                      onDuplicate={() => handleDuplicate(job)}
                      onDelete={() => handleDelete(job.id)}
                      onResetCount={() => handleResetCount(job.id)}
                    />
                  ))
                )}
              </div>
            </SortableContext>
          </DndContext>

          {showModal && (
            <JobModal
              job={editJob}
              senders={senders}
              onSubmit={editJob ? (data) => handleUpdate(editJob.id, data) : handleCreate}
              onClose={() => { setShowModal(false); setEditJob(null) }}
              loading={loading}
            />
          )}
        </>
      ) : (
        <SenderPage senders={senders} onDelete={handleDeleteSender} />
      )}

      {showSenderModal && (
        <SenderModal
          onSubmit={handleCreateSender}
          onClose={() => setShowSenderModal(false)}
        />
      )}
    </div>
  )
}
