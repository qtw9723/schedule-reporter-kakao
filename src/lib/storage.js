// src/lib/storage.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${file.name}: 파일 크기가 10MB를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
  }
}

export async function uploadFile(folderUuid, file) {
  validateFile(file)
  const ext = file.name.includes('.') ? file.name.split('.').pop() : ''
  const storageName = ext ? `${crypto.randomUUID()}.${ext}` : crypto.randomUUID()
  const path = `${folderUuid}/${storageName}`
  const { error } = await supabase.storage
    .from('attachments')
    .upload(path, file, { upsert: true })
  if (error) throw new Error(`업로드 실패: ${error.message}`)
  return { path, name: file.name, size: file.size }
}

export async function deleteFile(path) {
  const { error } = await supabase.storage
    .from('attachments')
    .remove([path])
  if (error) throw new Error(`삭제 실패: ${error.message}`)
}
