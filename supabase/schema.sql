-- stu-blog 資料庫結構
-- 在 Supabase 後台 → SQL Editor 貼上整份執行一次即可（重複執行也安全）。

-- ───────────── 管理員 ─────────────
-- 只有列在這張表裡的帳號可以寫入文章、標籤與圖片。
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
-- 不開任何 policy：前端讀不到也改不到這張表，只能在 SQL Editor 管理。

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ───────────── 標籤 ─────────────
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

-- ───────────── 文章 ─────────────
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) > 0),
  title text not null,
  subtitle text not null default '',
  content text not null default '',          -- Markdown 原文
  published boolean not null default false,  -- false = 草稿
  published_at timestamptz not null default now(), -- 張貼日期，可在後台修改
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_published_at_idx on public.posts (published_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at before update on public.posts
  for each row execute function public.touch_updated_at();

-- 文章 ↔ 標籤（多對多）
create table if not exists public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (post_id, tag_id)
);

-- ───────────── 權限（RLS） ─────────────
alter table public.tags enable row level security;
alter table public.posts enable row level security;
alter table public.post_tags enable row level security;

drop policy if exists "tags: anyone can read" on public.tags;
create policy "tags: anyone can read" on public.tags for select using (true);
drop policy if exists "tags: admin writes" on public.tags;
create policy "tags: admin writes" on public.tags for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "posts: read published" on public.posts;
create policy "posts: read published" on public.posts for select
  using (published or public.is_admin());
drop policy if exists "posts: admin writes" on public.posts;
create policy "posts: admin writes" on public.posts for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "post_tags: read with post" on public.post_tags;
create policy "post_tags: read with post" on public.post_tags for select
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and (p.published or public.is_admin())
  ));
drop policy if exists "post_tags: admin writes" on public.post_tags;
create policy "post_tags: admin writes" on public.post_tags for all
  using (public.is_admin()) with check (public.is_admin());

-- ───────────── 圖片儲存 ─────────────
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

drop policy if exists "post-images: admin upload" on storage.objects;
create policy "post-images: admin upload" on storage.objects for insert
  with check (bucket_id = 'post-images' and public.is_admin());
drop policy if exists "post-images: admin update" on storage.objects;
create policy "post-images: admin update" on storage.objects for update
  using (bucket_id = 'post-images' and public.is_admin());
drop policy if exists "post-images: admin delete" on storage.objects;
create policy "post-images: admin delete" on storage.objects for delete
  using (bucket_id = 'post-images' and public.is_admin());
-- bucket 是 public，所以圖片網址任何人都能讀取，不需要 select policy。

-- ───────────── 把自己設為管理員 ─────────────
-- 1. Authentication → Users → Add user，建立你的帳號（email + 密碼）
-- 2. 把下面的 email 換成你的，再執行這一行：
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com';
