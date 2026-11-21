import { supabaseConfigured } from '../lib/supabase'

export function Loading() {
  return <p className="status">載入中…</p>
}

export function ErrorMessage({ error }: { error: Error }) {
  if (!supabaseConfigured) {
    return (
      <p className="status status--error">
        還沒有設定 Supabase：請在專案根目錄建立 <code>.env.local</code>，填入
        <code>VITE_SUPABASE_URL</code> 和 <code>VITE_SUPABASE_ANON_KEY</code>。
      </p>
    )
  }
  return <p className="status status--error">發生錯誤：{error.message}</p>
}
