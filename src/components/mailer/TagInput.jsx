// src/components/TagInput.jsx
import { useState } from 'react'
import { X } from 'lucide-react'

export default function TagInput({ values, onChange, placeholder = '이메일 입력 후 Enter' }) {
  const [input, setInput] = useState('')

  const add = (raw) => {
    const email = raw.trim().replace(/,$/, '')
    if (!email || values.includes(email)) return
    onChange([...values, email])
  }

  const remove = (email) => onChange(values.filter(e => e !== email))

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(input)
      setInput('')
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      remove(values[values.length - 1])
    }
  }

  const handleBlur = () => {
    if (input) { add(input); setInput('') }
  }

  return (
    <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input')?.focus()}>
      {values.map(email => (
        <span key={email} className="tag-pill">
          {email}
          <button className="tag-pill-remove" onClick={() => remove(email)} type="button">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        className="tag-input-inner"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={values.length === 0 ? placeholder : ''}
      />
    </div>
  )
}
