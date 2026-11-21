import { Link, useSearchParams } from 'react-router'
import { ErrorMessage, Loading } from '../components/Status'
import { SiteHeader } from '../components/SiteHeader'
import { TagChip } from '../components/TagChip'
import { listPublishedPosts, listTags } from '../lib/api'
import { formatDate } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import './Posts.css'

export default function PostList() {
  const [params, setParams] = useSearchParams()
  const activeTag = params.get('tag')
  const [state] = useAsync(() => Promise.all([listPublishedPosts(), listTags()]), [])

  const toggleTag = (name: string) => {
    const next = new URLSearchParams(params)
    if (activeTag === name) next.delete('tag')
    else next.set('tag', name)
    setParams(next, { replace: true })
  }

  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1 className="page__title">文章</h1>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <ErrorMessage error={state.error} />}
        {state.status === 'ready' && (() => {
          const [posts, tags] = state.data
          const shown = activeTag ? posts.filter((p) => p.tags.some((t) => t.name === activeTag)) : posts
          return (
            <>
              {tags.length > 0 && (
                <div className="tag-filter" role="group" aria-label="依標籤篩選">
                  <TagChip active={!activeTag} onClick={() => activeTag && toggleTag(activeTag)}>全部</TagChip>
                  {tags.map((t) => (
                    <TagChip key={t.id} active={activeTag === t.name} onClick={() => toggleTag(t.name)}>
                      {t.name}
                    </TagChip>
                  ))}
                </div>
              )}
              {shown.length === 0 ? (
                <p className="status">{activeTag ? '這個標籤還沒有文章。' : '還沒有文章。'}</p>
              ) : (
                <ol className="post-list">
                  {shown.map((post) => (
                    <li key={post.id}>
                      <article className="post-card">
                        <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
                        <h2>
                          <Link to={`/posts/${encodeURIComponent(post.slug)}`}>{post.title}</Link>
                        </h2>
                        {post.subtitle && <p className="post-card__subtitle">{post.subtitle}</p>}
                        {post.tags.length > 0 && (
                          <div className="post-card__tags">
                            {post.tags.map((t) => (
                              <TagChip key={t.id} active={activeTag === t.name} onClick={() => toggleTag(t.name)}>
                                {t.name}
                              </TagChip>
                            ))}
                          </div>
                        )}
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )
        })()}
      </main>
    </>
  )
}
