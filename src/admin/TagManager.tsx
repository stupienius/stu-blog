import { useState, type FormEvent } from 'react'
import { ErrorMessage, Loading } from '../components/Status'
import { createTag, deleteTag, listTags, renameTag } from '../lib/api'
import type { Tag } from '../lib/types'
import { useAsync } from '../lib/useAsync'

export default function TagManager() {
  const [state, reload] = useAsync(listTags, [])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState('')

  const run = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
      reload()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (await run(() => createTag(name))) setName('')
  }

  const saveRename = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing || !editing.name.trim()) return
    if (await run(() => renameTag(editing.id, editing.name))) setEditing(null)
  }

  const remove = (tag: Tag) => {
    if (!window.confirm(`確定要刪除標籤「${tag.name}」嗎？已經貼上這個標籤的文章會一起移除它。`)) return
    run(() => deleteTag(tag.id))
  }

  return (
    <>
      <div className="admin__head">
        <h1>標籤</h1>
      </div>
      <p className="status">文章只能從這裡的標籤中挑選。</p>
      <form className="tag-add" onSubmit={add}>
        <input placeholder="新標籤名稱" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
        <button type="submit" className="pill-button pill-button--solid" disabled={!name.trim()}>新增</button>
      </form>
      {error && <p className="status status--error">{error}</p>}
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorMessage error={state.error} />}
      {state.status === 'ready' && (
        <ul className="tag-rows">
          {state.data.length === 0 && <li className="status">還沒有標籤。</li>}
          {state.data.map((tag) =>
            editing?.id === tag.id ? (
              <li key={tag.id}>
                <form className="tag-add" onSubmit={saveRename}>
                  <input
                    autoFocus
                    value={editing.name}
                    maxLength={30}
                    onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                  />
                  <button type="submit" className="pill-button">儲存</button>
                  <button type="button" className="link-button" onClick={() => setEditing(null)}>取消</button>
                </form>
              </li>
            ) : (
              <li key={tag.id}>
                <span className="tag-chip">{tag.name}</span>
                <span className="tag-rows__actions">
                  <button type="button" className="link-button" onClick={() => setEditing({ id: tag.id, name: tag.name })}>
                    改名
                  </button>
                  <button type="button" className="link-button link-button--danger" onClick={() => remove(tag)}>
                    刪除
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  )
}
