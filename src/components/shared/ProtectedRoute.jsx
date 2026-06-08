import { Navigate } from 'react-router-dom'
import { getCookie } from '../../lib/auth.js'

export default function ProtectedRoute({ children }) {
  return getCookie() ? children : <Navigate to="/login" replace />
}
