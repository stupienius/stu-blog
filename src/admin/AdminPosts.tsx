import { useState } from 'react'
import { Link } from 'react-router'
import { ErrorMessage, Loading } from '../components/Status'
import { deletePost, listAllPosts } from '../lib/api'
import { formatDate } from '../lib/format'
import type { Post } from '../lib/types'
import { useAsync } from '../lib/useAsync'

export default function AdminPosts() {
  const [state, reload] = useAsync(listAllPosts, [])
  const [error, setError] = useState('')

  const remove = async (post: Post) => {
    if (!window.confirm(`確定要刪除「${post.title}」嗎？刪除後無法復原。`)) return
    try {
      await deletePost(post.id)
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="admin__head">
        <h1>文章</h1>
        <Link to="/admin/posts/new" className="pill-button pill-button--solid">＋ 新增文章</Link>
      </div>
      {error && <p className="status status--error">{error}</p>}
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorMessage error={state.error} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <p className="status">還沒有文章，按右上角新增第一篇。</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>標題</th>
                <th>狀態</th>
                <th>張貼日期</th>
                <th>標籤</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {state.data.map((post) => (
                <tr key={post.id}>
                  <td>
                    <Link to={`/admin/posts/${post.id}`} className="admin-table__title">{post.title}</Link>
                    {post.subtitle && <div className="admin-table__sub">{post.subtitle}</div>}
                  </td>
                  <td>
                    <span className={`badge ${post.published ? 'badge--live' : ''}`}>
                      {post.published ? '已發布' : '草稿'}
                    </span>
                  </td>
                  <td className="nowrap">{formatDate(post.published_at)}</td>
                  <td>{post.tags.map((t) => t.name).join('、')}</td>
                  <td className="admin-table__actions">
                    {post.published && (
                      <Link to={`/posts/${encodeURIComponent(post.slug)}`} target="_blank">檢視</Link>
                    )}
                    <Link to={`/admin/posts/${post.id}`}>編輯</Link>
                    <button type="button" className="link-button link-button--danger" onClick={() => remove(post)}>
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </>
  )
}
