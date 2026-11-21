import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { Markdown } from '../components/Markdown'
import { ErrorMessage, Loading } from '../components/Status'
import { SiteHeader } from '../components/SiteHeader'
import { getPostBySlug } from '../lib/api'
import { formatDate } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import './Posts.css'

export default function PostPage() {
  const { slug = '' } = useParams()
  const [state] = useAsync(() => getPostBySlug(slug), [slug])
  const post = state.status === 'ready' ? state.data : null

  useEffect(() => {
    document.title = post ? `${post.title} · stupienius` : 'stupienius'
    return () => {
      document.title = 'stupienius'
    }
  }, [post])

  return (
    <>
      <SiteHeader />
      <main className="page page--narrow">
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <ErrorMessage error={state.error} />}
        {state.status === 'ready' && !post && (
          <p className="status">
            找不到這篇文章。<Link to="/posts">回文章列表</Link>
          </p>
        )}
        {post && (
          <article>
            <header className="post-header">
              <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
              <h1>{post.title}</h1>
              {post.subtitle && <p className="post-header__subtitle">{post.subtitle}</p>}
              {post.tags.length > 0 && (
                <div className="post-card__tags">
                  {post.tags.map((t) => (
                    <Link key={t.id} className="tag-chip" to={`/posts?tag=${encodeURIComponent(t.name)}`}>
                      {t.name}
                    </Link>
                  ))}
                </div>
              )}
            </header>
            <Markdown source={post.content} />
            <footer className="post-footer">
              <Link to="/posts">← 回文章列表</Link>
            </footer>
          </article>
        )}
      </main>
    </>
  )
}
