import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { AuthProvider, useAuth } from '../lib/auth'
import { supabase, supabaseConfigured } from '../lib/supabase'
import './Admin.css'

export default function AdminLayout() {
  return (
    <AuthProvider>
      <AdminShell />
    </AuthProvider>
  )
}

function AdminShell() {
  const { session, loading } = useAuth()

  if (loading) return null
  if (!session) return <Login />

  return (
    <div className="admin">
      <header className="admin__bar">
        <Link to="/admin" className="admin__brand">stupienius · 後台</Link>
        <nav className="admin__nav">
          <NavLink to="/admin" end>文章</NavLink>
          <NavLink to="/admin/tags">標籤</NavLink>
          <Link to="/posts" target="_blank">看網站 ↗</Link>
          <button type="button" className="link-button" onClick={() => supabase.auth.signOut()}>
            登出
          </button>
        </nav>
      </header>
      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email 或密碼錯誤。' : error.message)
  }

  return (
    <main className="admin-login">
      <form className="admin-login__card" onSubmit={submit}>
        <h1>後台登入</h1>
        {!supabaseConfigured && (
          <p className="status status--error">還沒有設定 Supabase（.env.local），目前無法登入。</p>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>密碼</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="status status--error">{error}</p>}
        <button type="submit" className="pill-button pill-button--solid" disabled={busy}>
          {busy ? '登入中…' : '登入'}
        </button>
      </form>
    </main>
  )
}
