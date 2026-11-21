export type Tag = {
  id: string
  name: string
}

export type Post = {
  id: string
  slug: string
  title: string
  subtitle: string
  content: string
  published: boolean
  published_at: string
  created_at: string
  updated_at: string
  tags: Tag[]
}

/** Fields the admin editor writes. */
export type PostInput = {
  slug: string
  title: string
  subtitle: string
  content: string
  published: boolean
  published_at: string
  tagIds: string[]
}
