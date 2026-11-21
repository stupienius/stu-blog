import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import Home from './pages/Home'

// the homepage stays light: everything else (Supabase, Markdown, the admin) loads on demand
const PostList = lazy(() => import('./pages/PostList'))
const PostPage = lazy(() => import('./pages/PostPage'))
const NotFound = lazy(() => import('./pages/NotFound'))
const AdminLayout = lazy(() => import('./admin/AdminLayout'))
const AdminPosts = lazy(() => import('./admin/AdminPosts'))
const PostEditor = lazy(() => import('./admin/PostEditor'))
const TagManager = lazy(() => import('./admin/TagManager'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/posts" element={<PostList />} />
          <Route path="/posts/:slug" element={<PostPage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminPosts />} />
            <Route path="posts/new" element={<PostEditor />} />
            <Route path="posts/:id" element={<PostEditor />} />
            <Route path="tags" element={<TagManager />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
