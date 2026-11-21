import { Link } from 'react-router'
import { SiteHeader } from '../components/SiteHeader'
import './Posts.css'

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1 className="page__title">找不到頁面</h1>
        <p className="status"><Link to="/posts">去看文章</Link></p>
      </main>
    </>
  )
}
