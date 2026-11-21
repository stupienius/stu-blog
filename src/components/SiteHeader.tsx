import { Link, NavLink } from 'react-router'
import './SiteHeader.css'

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link to="/" className="site-header__name">stupienius</Link>
      <nav>
        <NavLink to="/posts" end>文章</NavLink>
      </nav>
    </header>
  )
}
