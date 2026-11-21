import { useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Markdown } from '../components/Markdown'
import { ErrorMessage, Loading } from '../components/Status'
import { TagChip } from '../components/TagChip'
import { createPost, getPostById, listTags, updatePost, uploadImage } from '../lib/api'
import { fromLocalInput, slugify, toLocalInput } from '../lib/format'
import type { Post, Tag } from '../lib/types'
import { useAsync } from '../lib/useAsync'

export default function PostEditor() {
  const { id } = useParams()
  const [state] = useAsync(
    () => Promise.all([id ? getPostById(id) : Promise.resolve(null), listTags()]),
    [id],
  )

  if (state.status === 'loading') return <Loading />
  if (state.status === 'error') return <ErrorMessage error={state.error} />
  const [post, tags] = state.data
  if (id && !post) return <p className="status">找不到這篇文章。<Link to="/admin">回文章列表</Link></p>
  return <EditorForm key={id ?? 'new'} post={post} tags={tags} />
}

function EditorForm({ post, tags }: { post: Post | null; tags: Tag[] }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(post?.title ?? '')
  const [slug, setSlug] = useState(post?.slug ?? '')
  // follow the title until the slug is edited by hand
  const [slugTouched, setSlugTouched] = useState(Boolean(post))
  const [subtitle, setSubtitle] = useState(post?.subtitle ?? '')
  const [content, setContent] = useState(post?.content ?? '')
  const [published, setPublished] = useState(post?.published ?? false)
  const [date, setDate] = useState(() => toLocalInput(post?.published_at ?? new Date().toISOString()))
  const [tagIds, setTagIds] = useState<string[]>(post?.tags.map((t) => t.id) ?? [])
  const [view, setView] = useState<'write' | 'preview'>('write')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const toggleTag = (tagId: string) =>
    setTagIds((ids) => (ids.includes(tagId) ? ids.filter((x) => x !== tagId) : [...ids, tagId]))

  /** Inserts text at the cursor of the Markdown textarea. */
  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setContent((c) => c + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    setContent((c) => c.slice(0, start) + text + c.slice(end))
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + text.length
    })
  }

  const uploadFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setUploading((n) => n + images.length)
    setMessage(null)
    for (const file of images) {
      try {
        const url = await uploadImage(file)
        const alt = file.name.replace(/\.[^.]+$/, '')
        insertAtCursor(`\n![${alt}](${url})\n`)
      } catch (e) {
        setMessage({ kind: 'error', text: `圖片上傳失敗：${(e as Error).message}` })
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      uploadFiles(files)
    }
  }

  const onDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer.files)
    if (files.length) {
      e.preventDefault()
      uploadFiles(files)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const cleanSlug = slugify(slug)
    if (!title.trim() || !cleanSlug) {
      setMessage({ kind: 'error', text: '標題和網址代稱不能是空的。' })
      return
    }
    setSaving(true)
    setMessage(null)
    const input = {
      title: title.trim(),
      slug: cleanSlug,
      subtitle: subtitle.trim(),
      content,
      published,
      published_at: fromLocalInput(date),
      tagIds,
    }
    try {
      if (post) {
        await updatePost(post.id, input)
        setSlug(cleanSlug)
        setMessage({ kind: 'ok', text: '已儲存。' })
      } else {
        const newId = await createPost(input)
        navigate(`/admin/posts/${newId}`, { replace: true })
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="editor" onSubmit={save}>
      <div className="admin__head">
        <h1>{post ? '編輯文章' : '新增文章'}</h1>
        <div className="editor__actions">
          <Link to="/admin" className="link-button">← 返回</Link>
          {post?.published && (
            <Link to={`/posts/${encodeURIComponent(post.slug)}`} target="_blank" className="link-button">檢視 ↗</Link>
          )}
          <button type="submit" className="pill-button pill-button--solid" disabled={saving || uploading > 0}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
      {message && <p className={`status ${message.kind === 'error' ? 'status--error' : ''}`}>{message.text}</p>}

      <div className="editor__meta">
        <label className="field field--wide">
          <span>標題</span>
          <input required value={title} onChange={(e) => {
              setTitle(e.target.value)
              if (!slugTouched) setSlug(slugify(e.target.value))
            }}
          />
        </label>
        <label className="field field--wide">
          <span>副標題</span>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </label>
        <label className="field">
          <span>網址代稱</span>
          <input
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value)
            }}
          />
          <small>/posts/{slugify(slug) || '…'}</small>
        </label>
        <label className="field">
          <span>張貼日期</span>
          <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="field field--wide">
          <span>標籤</span>
          <div className="editor__tags">
            {tags.length === 0 && (
              <small>還沒有標籤，先到 <Link to="/admin/tags">標籤管理</Link> 新增。</small>
            )}
            {tags.map((t) => (
              <TagChip key={t.id} active={tagIds.includes(t.id)} onClick={() => toggleTag(t.id)}>
                {t.name}
              </TagChip>
            ))}
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          <span>{published ? '已發布（所有人看得到）' : '草稿（只有你看得到）'}</span>
        </label>
      </div>

      <div className="editor__toolbar">
        <div className="editor__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'write'} onClick={() => setView('write')}>撰寫</button>
          <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>預覽</button>
        </div>
        <button type="button" className="link-button" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? `上傳中（${uploading}）…` : '上傳圖片'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      <div className={`editor__panes is-${view}`}>
        <textarea
          ref={textareaRef}
          className="editor__source"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          placeholder="用 Markdown 寫文章，圖片可以直接貼上或拖進來…"
          spellCheck={false}
        />
        <div className="editor__preview">
          {content.trim() ? <Markdown source={content} /> : <p className="status">預覽會顯示在這裡。</p>}
        </div>
      </div>
    </form>
  )
}
