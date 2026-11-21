import { IMAGE_BUCKET, supabase } from './supabase'
import type { Post, PostInput, Tag } from './types'

const POST_COLUMNS =
  'id, slug, title, subtitle, content, published, published_at, created_at, updated_at, post_tags(tags(id, name))'
const LIST_COLUMNS =
  'id, slug, title, subtitle, published, published_at, created_at, updated_at, post_tags(tags(id, name))'

type Row = Omit<Post, 'tags' | 'content'> & {
  content?: string
  post_tags?: { tags: Tag | null }[]
}

function toPost(row: Row): Post {
  const tags = (row.post_tags ?? [])
    .map((pt) => pt.tags)
    .filter((t): t is Tag => Boolean(t))
    .sort((a, b) => a.name.localeCompare(b.name))
  const { post_tags: _ignored, ...rest } = row
  return { content: '', ...rest, tags }
}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

// ───────────── 文章 ─────────────

/** Published posts, newest first. RLS also returns drafts when the admin is signed in, so filter here. */
export async function listPublishedPosts(): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select(LIST_COLUMNS)
    .eq('published', true)
    .order('published_at', { ascending: false })
  fail(error)
  return (data as unknown as Row[]).map(toPost)
}

/** Every post including drafts (admin only, enforced by RLS). */
export async function listAllPosts(): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select(LIST_COLUMNS)
    .order('published_at', { ascending: false })
  fail(error)
  return (data as unknown as Row[]).map(toPost)
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()
  fail(error)
  return data ? toPost(data as unknown as Row) : null
}

export async function getPostById(id: string): Promise<Post | null> {
  const { data, error } = await supabase.from('posts').select(POST_COLUMNS).eq('id', id).maybeSingle()
  fail(error)
  return data ? toPost(data as unknown as Row) : null
}

async function setPostTags(postId: string, tagIds: string[]) {
  const { error: delError } = await supabase.from('post_tags').delete().eq('post_id', postId)
  fail(delError)
  if (tagIds.length === 0) return
  const { error } = await supabase
    .from('post_tags')
    .insert(tagIds.map((tag_id) => ({ post_id: postId, tag_id })))
  fail(error)
}

function friendly(error: { message: string; code?: string } | null) {
  if (error?.code === '23505') return new Error('這個網址代稱已經被其他文章使用了，請換一個。')
  return error ? new Error(error.message) : null
}

export async function createPost(input: PostInput): Promise<string> {
  const { tagIds, ...fields } = input
  const { data, error } = await supabase.from('posts').insert(fields).select('id').single()
  const err = friendly(error)
  if (err) throw err
  await setPostTags(data!.id, tagIds)
  return data!.id
}

export async function updatePost(id: string, input: PostInput): Promise<void> {
  const { tagIds, ...fields } = input
  const { error } = await supabase.from('posts').update(fields).eq('id', id)
  const err = friendly(error)
  if (err) throw err
  await setPostTags(id, tagIds)
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', id)
  fail(error)
}

// ───────────── 標籤 ─────────────

export async function listTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from('tags').select('id, name').order('name')
  fail(error)
  return data as Tag[]
}

export async function createTag(name: string): Promise<void> {
  const { error } = await supabase.from('tags').insert({ name: name.trim() })
  if (error?.code === '23505') throw new Error('已經有這個標籤了。')
  fail(error)
}

export async function renameTag(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('tags').update({ name: name.trim() }).eq('id', id)
  if (error?.code === '23505') throw new Error('已經有這個標籤了。')
  fail(error)
}

export async function deleteTag(id: string): Promise<void> {
  const { error } = await supabase.from('tags').delete().eq('id', id)
  fail(error)
}

// ───────────── 圖片 ─────────────

/** Uploads an image to Supabase Storage and returns its public URL. */
export async function uploadImage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const now = new Date()
  const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  fail(error)
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
