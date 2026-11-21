import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** false until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set in .env.local */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'missing-anon-key',
)

export const IMAGE_BUCKET = 'post-images'
